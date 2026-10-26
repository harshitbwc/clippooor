import { and, asc, desc, eq, inArray, ne, notExists } from "drizzle-orm";
import { db } from "./client";
import { channels, clips, connections, publishJobs, sourceVideos } from "./schema";

export type Platform = "youtube" | "instagram";

export function listChannels() {
  return db.select().from(channels).orderBy(channels.createdAt);
}

// Per-channel roll-up for the dashboard: how many clips are still in
// flight, how many have failed, how many have posted, plus connection and
// YouTube-audit status — everything needed to spot trouble at a glance.
export async function listChannelsWithStats() {
  const allChannels = await listChannels();

  const [clipRows, sourceRows, connRows] = await Promise.all([
    db
      .select({ channelId: sourceVideos.channelId, status: clips.status })
      .from(clips)
      .innerJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id)),
    db.select({ channelId: sourceVideos.channelId, status: sourceVideos.status }).from(sourceVideos),
    db.select({ channelId: connections.channelId, platform: connections.platform }).from(connections),
  ]);

  return allChannels.map((channel) => {
    const myClips = clipRows.filter((c) => c.channelId === channel.id);
    const mySources = sourceRows.filter((s) => s.channelId === channel.id);
    const myConns = connRows.filter((c) => c.channelId === channel.id);
    return {
      ...channel,
      pendingClips: myClips.filter((c) => !["posted", "failed"].includes(c.status)).length,
      failedClips: myClips.filter((c) => c.status === "failed").length,
      postedClips: myClips.filter((c) => c.status === "posted").length,
      failedSourceVideos: mySources.filter((s) => s.status === "failed").length,
      youtubeConnected: myConns.some((c) => c.platform === "youtube"),
      instagramConnected: myConns.some((c) => c.platform === "instagram"),
    };
  });
}

export function getChannel(id: string) {
  return db.query.channels.findFirst({ where: eq(channels.id, id) });
}

export function createChannel(input: { name: string; ctaTemplate?: string | null }) {
  return db
    .insert(channels)
    .values({ name: input.name, ctaTemplate: input.ctaTemplate ?? null })
    .returning();
}

export function updateChannel(
  id: string,
  input: Partial<{
    name: string;
    ctaTemplate: string | null;
    postTimes: string[];
    youtubeAuditPending: boolean;
  }>,
) {
  return db.update(channels).set(input).where(eq(channels.id, id)).returning();
}

export function deleteChannel(id: string) {
  return db.delete(channels).where(eq(channels.id, id)).returning();
}

// Every R2 object key (source videos + rendered clips) belonging to a
// channel — gathered before deletion so the caller can clean up storage
// once the DB rows are gone (cascade deletes the rows, not the blobs).
export async function listStorageKeysForChannel(channelId: string): Promise<string[]> {
  const sources = await db
    .select({ storageKey: sourceVideos.storageKey })
    .from(sourceVideos)
    .where(eq(sourceVideos.channelId, channelId));

  const renders = await db
    .select({ renderKey: clips.renderKey })
    .from(clips)
    .innerJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(eq(sourceVideos.channelId, channelId));

  return [
    ...sources.map((s) => s.storageKey),
    ...renders.map((r) => r.renderKey),
  ].filter((key): key is string => Boolean(key));
}

export function listConnectionsByChannel(channelId: string) {
  return db.select().from(connections).where(eq(connections.channelId, channelId));
}

export function getConnection(channelId: string, platform: Platform) {
  return db.query.connections.findFirst({
    where: (c, { and, eq }) => and(eq(c.channelId, channelId), eq(c.platform, platform)),
  });
}

export function upsertConnection(input: {
  channelId: string;
  platform: Platform;
  accountId: string;
  pageId?: string | null;
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  expiresAt?: Date | null;
}) {
  return db
    .insert(connections)
    .values(input)
    .onConflictDoUpdate({
      target: [connections.channelId, connections.platform],
      set: {
        accountId: input.accountId,
        pageId: input.pageId ?? null,
        accessTokenEnc: input.accessTokenEnc,
        refreshTokenEnc: input.refreshTokenEnc ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    })
    .returning();
}

export function listSourceVideosByChannel(channelId: string) {
  return db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.channelId, channelId))
    .orderBy(desc(sourceVideos.createdAt));
}

export function getSourceVideo(id: string) {
  return db.query.sourceVideos.findFirst({ where: eq(sourceVideos.id, id) });
}

export function createSourceVideo(input: {
  channelId: string;
  sourceType: "upload" | "youtube_url";
  sourceUrl?: string | null;
  storageKey?: string | null;
  caption: string;
}) {
  return db
    .insert(sourceVideos)
    .values({
      channelId: input.channelId,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl ?? null,
      storageKey: input.storageKey ?? null,
      caption: input.caption,
    })
    .returning();
}

export function updateSourceVideo(
  id: string,
  input: Partial<{
    storageKey: string | null;
    durationMs: number | null;
    transcript: unknown;
    status: string;
    error: string | null;
  }>,
) {
  return db.update(sourceVideos).set(input).where(eq(sourceVideos.id, id)).returning();
}

export function listClipsBySourceVideo(sourceVideoId: string) {
  return db
    .select()
    .from(clips)
    .where(eq(clips.sourceVideoId, sourceVideoId))
    .orderBy(clips.startMs);
}

export function createClips(
  rows: Array<{
    sourceVideoId: string;
    partNumber: number;
    startMs: number;
    endMs: number;
    title?: string | null;
    status?: string;
  }>,
) {
  if (rows.length === 0) return Promise.resolve([]);
  return db.insert(clips).values(rows).returning();
}

export function getClip(id: string) {
  return db.query.clips.findFirst({ where: eq(clips.id, id) });
}

// Every non-posted clip across a channel, with enough source-video and
// scheduling info to render the "Clipped Reels" table without follow-up
// queries per row. Posted clips move to the status page instead.
export async function listClippedReelsByChannel(channelId: string) {
  const rows = await db
    .select({
      id: clips.id,
      sourceVideoId: clips.sourceVideoId,
      partNumber: clips.partNumber,
      startMs: clips.startMs,
      endMs: clips.endMs,
      title: clips.title,
      renderKey: clips.renderKey,
      status: clips.status,
      error: clips.error,
      postedAt: clips.postedAt,
      createdAt: clips.createdAt,
      sourceType: sourceVideos.sourceType,
      sourceUrl: sourceVideos.sourceUrl,
      storageKey: sourceVideos.storageKey,
      caption: sourceVideos.caption,
    })
    .from(clips)
    .innerJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(and(eq(sourceVideos.channelId, channelId), ne(clips.status, "posted")))
    .orderBy(desc(clips.createdAt));

  const clipIds = rows.map((r) => r.id);
  const jobs = clipIds.length
    ? await db
        .select({ clipId: publishJobs.clipId, scheduledAt: publishJobs.scheduledAt })
        .from(publishJobs)
        .where(inArray(publishJobs.clipId, clipIds))
    : [];
  const scheduledAtByClip = new Map(jobs.map((j) => [j.clipId, j.scheduledAt]));

  return rows.map((row) => ({
    ...row,
    scheduledAt: scheduledAtByClip.get(row.id) ?? null,
  }));
}

// Highest partNumber currently assigned among a source video's clips, or 0 if
// it has none yet — used to append a manually-added clip after the last part.
export async function getMaxPartNumber(sourceVideoId: string): Promise<number> {
  const rows = await db
    .select({ partNumber: clips.partNumber })
    .from(clips)
    .where(eq(clips.sourceVideoId, sourceVideoId))
    .orderBy(desc(clips.partNumber))
    .limit(1);
  return rows[0]?.partNumber ?? 0;
}

export function createClip(input: {
  sourceVideoId: string;
  partNumber: number;
  startMs: number;
  endMs: number;
  title?: string | null;
  status?: string;
}) {
  return db.insert(clips).values(input).returning();
}

export function updateClip(
  id: string,
  input: Partial<{
    startMs: number;
    endMs: number;
    title: string | null;
    renderKey: string | null;
    status: string;
    error: string | null;
    postedAt: Date | null;
  }>,
) {
  return db.update(clips).set(input).where(eq(clips.id, id)).returning();
}

export function deleteClip(id: string) {
  return db.delete(clips).where(eq(clips.id, id)).returning();
}

export async function getOldestRenderedClipWithoutPublishJobs(channelId: string) {
  const rows = await db
    .select({
      id: clips.id,
      sourceVideoId: clips.sourceVideoId,
      partNumber: clips.partNumber,
      startMs: clips.startMs,
      endMs: clips.endMs,
      title: clips.title,
      renderKey: clips.renderKey,
      status: clips.status,
      createdAt: clips.createdAt,
    })
    .from(clips)
    .innerJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(
      and(
        eq(sourceVideos.channelId, channelId),
        eq(clips.status, "rendered"),
        notExists(db.select().from(publishJobs).where(eq(publishJobs.clipId, clips.id))),
      ),
    )
    .orderBy(asc(clips.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// Per-source-video clip roll-up for the status table: total parts, how many
// posted vs still pending, and each part's own status/timestamp.
export async function listSourceVideoStatusByChannel(channelId: string) {
  const sources = await db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.channelId, channelId))
    .orderBy(desc(sourceVideos.createdAt));

  const allClips = await db
    .select({
      id: clips.id,
      sourceVideoId: clips.sourceVideoId,
      partNumber: clips.partNumber,
      status: clips.status,
      postedAt: clips.postedAt,
    })
    .from(clips)
    .innerJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(eq(sourceVideos.channelId, channelId))
    .orderBy(asc(clips.partNumber));

  return sources.map((source) => {
    const sourceClips = allClips.filter((c) => c.sourceVideoId === source.id);
    return {
      ...source,
      totalParts: sourceClips.length,
      postedCount: sourceClips.filter((c) => c.status === "posted").length,
      pendingCount: sourceClips.filter((c) => c.status !== "posted").length,
      clips: sourceClips,
    };
  });
}

export function createPublishJobs(clipId: string, scheduledAt: Date) {
  return db
    .insert(publishJobs)
    .values([
      { clipId, platform: "youtube", scheduledAt },
      { clipId, platform: "instagram", scheduledAt },
    ])
    .returning();
}

export function getPublishJob(id: string) {
  return db.query.publishJobs.findFirst({ where: eq(publishJobs.id, id) });
}

export function listPublishJobsByClip(clipId: string) {
  return db.select().from(publishJobs).where(eq(publishJobs.clipId, clipId));
}

export function updatePublishJob(
  id: string,
  input: Partial<{
    status: string;
    externalPostId: string | null;
    error: string | null;
  }>,
) {
  return db.update(publishJobs).set(input).where(eq(publishJobs.id, id)).returning();
}
