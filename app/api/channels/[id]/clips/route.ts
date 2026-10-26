import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClip, getMaxPartNumber, getSourceVideo, listClippedReelsByChannel } from "@/db/queries";
import { sendClipApproved } from "@/inngest/client";
import { getPublicUrl } from "@/lib/r2";

const MAX_CLIP_DURATION_MS = 90_000;

const createClipSchema = z
  .object({
    source_video_id: z.string().uuid(),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().positive(),
  })
  .refine((data) => data.end_ms > data.start_ms, {
    message: "end_ms must be greater than start_ms",
    path: ["end_ms"],
  })
  .refine((data) => data.end_ms - data.start_ms <= MAX_CLIP_DURATION_MS, {
    message: "Clips must be 90 seconds or shorter",
    path: ["end_ms"],
  });

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await listClippedReelsByChannel(id);
  const clips = rows.map((row) => ({
    ...row,
    previewUrl: row.renderKey ? getPublicUrl(row.renderKey) : null,
  }));
  return NextResponse.json({ clips });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: channelId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createClipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const sourceVideo = await getSourceVideo(parsed.data.source_video_id);
  if (!sourceVideo || sourceVideo.channelId !== channelId) {
    return NextResponse.json({ error: "Source video not found on this channel" }, { status: 404 });
  }

  const partNumber = (await getMaxPartNumber(parsed.data.source_video_id)) + 1;

  // No manual approval step — a clip the operator explicitly adds is
  // implicitly approved, so it goes straight into rendering.
  const [clip] = await createClip({
    sourceVideoId: parsed.data.source_video_id,
    partNumber,
    startMs: parsed.data.start_ms,
    endMs: parsed.data.end_ms,
    title: `Part ${partNumber} #Shorts`,
    status: "approved",
  });
  await sendClipApproved(clip.id);

  return NextResponse.json({ clip }, { status: 201 });
}
