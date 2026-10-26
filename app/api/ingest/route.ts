import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSourceVideo, getChannel } from "@/db/queries";
import { sendVideoIngested } from "@/inngest/client";

const ingestSchema = z.discriminatedUnion("source_type", [
  z.object({
    channel_id: z.string().uuid(),
    source_type: z.literal("upload"),
    storage_key: z.string().trim().min(1),
    caption: z.string().trim().min(1),
  }),
  z.object({
    channel_id: z.string().uuid(),
    source_type: z.literal("youtube_url"),
    youtube_url: z.string().trim().url(),
    caption: z.string().trim().min(1),
  }),
]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const channel = await getChannel(parsed.data.channel_id);
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const [sourceVideo] = await createSourceVideo(
    parsed.data.source_type === "upload"
      ? {
          channelId: parsed.data.channel_id,
          sourceType: "upload",
          storageKey: parsed.data.storage_key,
          caption: parsed.data.caption,
        }
      : {
          channelId: parsed.data.channel_id,
          sourceType: "youtube_url",
          sourceUrl: parsed.data.youtube_url,
          caption: parsed.data.caption,
        },
  );

  await sendVideoIngested(sourceVideo.id);

  return NextResponse.json({ sourceVideo }, { status: 201 });
}
