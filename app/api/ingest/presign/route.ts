import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getChannel } from "@/db/queries";
import { getPresignedUploadUrl } from "@/lib/r2";

const presignSchema = z.object({
  channel_id: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(1).max(255),
});

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = presignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const channel = await getChannel(parsed.data.channel_id);
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const storageKey = `sources/${channel.id}/${crypto.randomUUID()}-${sanitizeFilename(parsed.data.filename)}`;
  const uploadUrl = await getPresignedUploadUrl(storageKey, parsed.data.content_type);

  return NextResponse.json({ storageKey, uploadUrl });
}
