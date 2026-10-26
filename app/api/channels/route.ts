import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createChannel, listChannels } from "@/db/queries";

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ctaTemplate: z.string().trim().max(500).optional(),
});

export async function GET() {
  const rows = await listChannels();
  return NextResponse.json({ channels: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createChannelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [channel] = await createChannel(parsed.data);
  return NextResponse.json({ channel }, { status: 201 });
}
