import { InngestFunction, NonRetriableError } from "inngest";
import { inngest, sendClipApproved, sendPublishJobCreated } from "./client";
import {
  createClips,
  createPublishJobs,
  getChannel,
  getClip,
  getConnection,
  getOldestRenderedClipWithoutPublishJobs,
  getPublishJob,
  getSourceVideo,
  listChannels,
  listClipsBySourceVideo,
  listConnectionsByChannel,
  listPublishJobsByClip,
  updateChannel,
  updateClip,
  updatePublishJob,
  updateSourceVideo,
} from "@/db/queries";
import { fetchSource, renderClip, transcribe } from "@/lib/modal";
import { computeClipRanges } from "@/lib/clipping";
import { buildRelativeCaptions } from "@/lib/captions";
import {
  getValidAccessToken as getValidYoutubeAccessToken,
  uploadVideo as uploadYoutubeVideo,
} from "@/lib/youtube";
import {
  createReelContainer,
  getContainerStatus,
  getValidAccessToken as getValidInstagramAccessToken,
  publishReelContainer,
} from "@/lib/instagram";
import { deleteObject, getObjectStream, getPublicUrl } from "@/lib/r2";
import { sendAlert } from "@/lib/alerts";
import { SCHEDULER_INTERVAL_MIN, isPostTimeDue } from "@/lib/schedule";

const DEFAULT_CTA_TEXT = "Follow for more BTS";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Runs once a function has exhausted all its retries, so a flaky step that
// recovers on retry never pages anyone.
function alertOnFailure(functionName: string) {
  return async ({ error }: { error: Error }) => {
    await sendAlert(`Clippooor: "${functionName}" failed after retries: ${error.message}`);
  };
}

// Every clip cut from a source video shares that video's operator-provided
// caption — there's no per-clip caption anymore.
function buildPublishCaption(source: { caption: string | null }): string {
  return source.caption ?? "";
}

// Once every clip cut from a source video has posted, the raw source file
// has served its purpose (all clips are already rendered) — delete it from
// R2 to stop paying for it. Rendered clips are untouched. Best-effort: a
// failure here shouldn't break the publish flow that triggered it.
async function maybeCleanupSourceVideo(sourceVideoId: string): Promise<void> {
  const source = await getSourceVideo(sourceVideoId);
  if (!source || !source.storageKey) return;

  const siblingClips = await listClipsBySourceVideo(sourceVideoId);
  if (siblingClips.length === 0 || !siblingClips.every((c) => c.status === "posted")) return;

  try {
    await deleteObject(source.storageKey);
    await updateSourceVideo(sourceVideoId, { storageKey: null });
  } catch (err) {
    console.error(`Failed to clean up source video ${sourceVideoId} from R2:`, err);
  }
}

// After a publish_job reaches a terminal state, roll the clip's overall
// status up from its two publish_jobs: posted (with a timestamp) only once
// both platforms are posted, failed as soon as either platform fails.
async function reconcileClipStatus(clipId: string): Promise<void> {
  const jobs = await listPublishJobsByClip(clipId);
  if (jobs.some((j) => j.status === "failed")) {
    await updateClip(clipId, { status: "failed" });
  } else if (jobs.length > 0 && jobs.every((j) => j.status === "posted")) {
    const clip = await updateClip(clipId, { status: "posted", postedAt: new Date() });
    const sourceVideoId = clip[0]?.sourceVideoId;
    if (sourceVideoId) await maybeCleanupSourceVideo(sourceVideoId);
  }
}

// Exponential-ish backoff for polling an Instagram media container, capped
// at 30s between polls per §9c ("min 10s between polls").
function igPollDelaySeconds(attempt: number): number {
  return Math.min(10 + attempt * 5, 30);
}

export const ingestPipeline = inngest.createFunction(
  {
    id: "ingest-pipeline",
    triggers: [{ event: "video/ingested" }],
    onFailure: alertOnFailure("ingest-pipeline"),
  },
  async ({ event, step }) => {
    const sourceVideoId = event.data.sourceVideoId as string;

    const source = await step.run("load-source", async () => {
      const row = await getSourceVideo(sourceVideoId);
      if (!row) throw new NonRetriableError(`source_video ${sourceVideoId} not found`);
      return row;
    });

    let storageKey = source.storageKey;

    if (source.sourceType === "youtube_url") {
      try {
        const fetched = await step.run("fetch-from-youtube", () =>
          fetchSource(source.sourceUrl as string, `sources/${source.channelId}/${source.id}`),
        );
        storageKey = fetched.storageKey;
        await step.run("mark-transcribing-after-fetch", () =>
          updateSourceVideo(source.id, {
            storageKey: fetched.storageKey,
            durationMs: fetched.durationMs,
            status: "transcribing",
          }),
        );
      } catch (err) {
        // yt-dlp is fragile and ToS-gray — never let it take down the pipeline.
        // Surface a clear failure so the operator can upload the file instead.
        await step.run("mark-fetch-failed", () =>
          updateSourceVideo(source.id, {
            status: "failed",
            error: `Download failed: ${errorMessage(err)} — upload the file instead.`,
          }),
        );
        throw new NonRetriableError("yt-dlp fetch failed");
      }
    } else {
      await step.run("mark-transcribing", () =>
        updateSourceVideo(source.id, { status: "transcribing" }),
      );
    }

    if (!storageKey) {
      throw new NonRetriableError(`source_video ${sourceVideoId} has no storage key`);
    }

    let transcription: Awaited<ReturnType<typeof transcribe>>;
    try {
      transcription = await step.run("transcribe", () => transcribe(storageKey as string));
    } catch (err) {
      await step.run("mark-transcribe-failed", () =>
        updateSourceVideo(source.id, {
          status: "failed",
          error: `Transcription failed: ${errorMessage(err)}`,
        }),
      );
      throw err;
    }

    await step.run("save-transcript", () =>
      updateSourceVideo(source.id, {
        transcript: transcription.segments,
        durationMs: transcription.durationMs,
      }),
    );

    // Mechanical split — fixed 45s parts, trailing remainder under 20s
    // dropped — rather than an AI-guessed "best moments" selection.
    const ranges = computeClipRanges(transcription.durationMs);

    // Clips need no manual approval — they're mechanically cut, so as soon
    // as they exist they're queued straight into rendering.
    const createdClips = await step.run("save-clips", () =>
      createClips(
        ranges.map((range, index) => ({
          sourceVideoId: source.id,
          partNumber: index + 1,
          startMs: range.startMs,
          endMs: range.endMs,
          title: `Part ${index + 1} #Shorts`,
          status: "approved",
        })),
      ),
    );

    await step.run("trigger-renders", async () => {
      for (const clip of createdClips) {
        await sendClipApproved(clip.id);
      }
    });

    await step.run("mark-ready", () => updateSourceVideo(source.id, { status: "ready" }));
  },
);

export const renderClipFn = inngest.createFunction(
  {
    id: "render-clip",
    triggers: [{ event: "clip/approved" }],
    onFailure: alertOnFailure("render-clip"),
  },
  async ({ event, step }) => {
    const clipId = event.data.clipId as string;

    const clip = await step.run("load-clip", async () => {
      const row = await getClip(clipId);
      if (!row) throw new NonRetriableError(`clip ${clipId} not found`);
      return row;
    });

    const source = await step.run("load-source", async () => {
      const row = await getSourceVideo(clip.sourceVideoId);
      if (!row || !row.storageKey) {
        throw new NonRetriableError(`source video for clip ${clipId} has no storage key`);
      }
      return row;
    });

    const channel = await step.run("load-channel", async () => {
      const row = await getChannel(source.channelId);
      if (!row) throw new NonRetriableError(`channel ${source.channelId} not found`);
      return row;
    });

    try {
      const outputStorageKey = `clips/${channel.id}/${clip.id}.mp4`;
      const captions = buildRelativeCaptions(source.transcript, clip.startMs, clip.endMs);

      const rendered = await step.run("render", () =>
        renderClip({
          sourceStorageKey: source.storageKey as string,
          startMs: clip.startMs,
          endMs: clip.endMs,
          partLabel: `Part ${clip.partNumber}`,
          ctaText: channel.ctaTemplate ?? DEFAULT_CTA_TEXT,
          captions,
          outputStorageKey,
        }),
      );

      await step.run("save-render", () =>
        updateClip(clip.id, { renderKey: rendered.storageKey, status: "rendered" }),
      );
    } catch (err) {
      await step.run("mark-render-failed", () =>
        updateClip(clip.id, {
          status: "failed",
          error: `Render failed: ${errorMessage(err)}`,
        }),
      );
      throw err;
    }
  },
);

export const dailyScheduler = inngest.createFunction(
  {
    id: "daily-scheduler",
    triggers: [{ cron: `*/${SCHEDULER_INTERVAL_MIN} * * * *` }],
    onFailure: alertOnFailure("daily-scheduler"),
  },
  async ({ step }) => {
    // Each channel posts at its own times in its own timezone; only channels
    // with a post time inside this tick's window get a clip scheduled. The
    // clock is read inside a step so replays reuse the same answer.
    const channels = await step.run("load-due-channels", async () => {
      const now = new Date();
      const all = await listChannels();
      return all.filter((c) => isPostTimeDue(c.postTimes, c.scheduleTz, now));
    });

    for (const channel of channels) {
      await step.run(`schedule-channel-${channel.id}`, async () => {
        // No point queuing a publish that's guaranteed to fail — wait until
        // at least one platform is connected.
        const connections = await listConnectionsByChannel(channel.id);
        if (connections.length === 0) return { channelId: channel.id, scheduled: false };

        const clip = await getOldestRenderedClipWithoutPublishJobs(channel.id);
        if (!clip) return { channelId: channel.id, scheduled: false };

        await updateClip(clip.id, { status: "scheduled" });
        const jobs = await createPublishJobs(clip.id, new Date());
        for (const job of jobs) {
          await sendPublishJobCreated(job.id);
        }
        return { channelId: channel.id, scheduled: true, clipId: clip.id };
      });
    }
  },
);

export const publishClip = inngest.createFunction(
  {
    id: "publish-clip",
    triggers: [{ event: "publish/job.created" }],
    onFailure: alertOnFailure("publish-clip"),
  },
  async ({ event, step }) => {
    const publishJobId = event.data.publishJobId as string;

    const job = await step.run("load-job", async () => {
      const row = await getPublishJob(publishJobId);
      if (!row) throw new NonRetriableError(`publish_job ${publishJobId} not found`);
      return row;
    });

    const clip = await step.run("load-clip", async () => {
      const row = await getClip(job.clipId);
      if (!row || !row.renderKey) {
        throw new NonRetriableError(`clip ${job.clipId} has no render_key`);
      }
      return row;
    });

    const source = await step.run("load-source-for-publish", () =>
      getSourceVideo(clip.sourceVideoId),
    );
    if (!source) throw new NonRetriableError(`source video for clip ${clip.id} not found`);

    const channel = await step.run("load-channel-for-publish", async () => {
      const row = await getChannel(source.channelId);
      if (!row) throw new NonRetriableError(`channel ${source.channelId} not found`);
      return row;
    });

    try {
      await step.run("mark-publishing", () =>
        updatePublishJob(job.id, { status: "publishing", error: null }),
      );

      if (job.platform === "youtube") {
        const accessToken = await step.run("yt-token", () =>
          getValidYoutubeAccessToken(channel.id),
        );
        const { videoId, privacyStatus } = await step.run("yt-upload", async () => {
          const videoStream = await getObjectStream(clip.renderKey as string);
          return uploadYoutubeVideo({
            accessToken,
            videoStream,
            title: clip.title ?? `Part ${clip.partNumber} #Shorts`,
            description: buildPublishCaption(source),
          });
        });
        // Uploads from an unaudited API project are silently forced private
        // — this is the only reliable signal the audit is still pending.
        await step.run("track-audit-status", () =>
          updateChannel(channel.id, { youtubeAuditPending: privacyStatus === "private" }),
        );
        await step.run("save-yt-result", () =>
          updatePublishJob(job.id, { status: "posted", externalPostId: videoId, error: null }),
        );
      } else {
        const accessToken = await step.run("ig-token", () =>
          getValidInstagramAccessToken(channel.id),
        );
        const connection = await step.run("ig-connection", async () => {
          const row = await getConnection(channel.id, "instagram");
          if (!row) throw new NonRetriableError(`No Instagram connection for channel ${channel.id}`);
          return row;
        });

        const { containerId } = await step.run("ig-create-container", () =>
          createReelContainer({
            igUserId: connection.accountId,
            accessToken,
            videoUrl: getPublicUrl(clip.renderKey as string),
            caption: buildPublishCaption(source),
          }),
        );

        let status = "IN_PROGRESS";
        for (let attempt = 0; attempt < 20 && status !== "FINISHED"; attempt++) {
          await step.sleep(`ig-poll-wait-${attempt}`, `${igPollDelaySeconds(attempt)}s`);
          status = await step.run(`ig-poll-${attempt}`, () =>
            getContainerStatus(containerId, accessToken),
          );
          if (status === "ERROR") {
            throw new Error("Instagram reported an error processing the video container");
          }
        }
        if (status !== "FINISHED") {
          throw new Error("Instagram container did not finish processing in time");
        }

        const { mediaId } = await step.run("ig-publish", () =>
          publishReelContainer(connection.accountId, containerId, accessToken),
        );
        await step.run("save-ig-result", () =>
          updatePublishJob(job.id, { status: "posted", externalPostId: mediaId, error: null }),
        );
      }
    } catch (err) {
      await step.run("mark-publish-failed", () =>
        updatePublishJob(job.id, { status: "failed", error: errorMessage(err) }),
      );
      await step.run("reconcile-clip-status-failed", () => reconcileClipStatus(clip.id));
      throw err;
    }

    await step.run("reconcile-clip-status", () => reconcileClipStatus(clip.id));
  },
);

export const functions: InngestFunction.Any[] = [
  ingestPipeline,
  renderClipFn,
  dailyScheduler,
  publishClip,
];
