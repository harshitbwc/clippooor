import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteChannel,
  getChannel,
  listConnectionsByChannel,
  listSourceVideosByChannel,
  listStorageKeysForChannel,
  updateChannel,
} from "@/db/queries";
import { deleteObjects } from "@/lib/r2";

const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  ctaTemplate: z.string().trim().max(500).nullable().optional(),
  postTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const channel = await getChannel(id);
  if (!channel) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [channelConnections, sourceVideos] = await Promise.all([
    listConnectionsByChannel(id),
    listSourceVideosByChannel(id),
  ]);
  return NextResponse.json({
    channel,
    connections: channelConnections.map((c) => ({
      platform: c.platform,
      accountId: c.accountId,
      pageId: c.pageId,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
    })),
    sourceVideos,
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateChannelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [channel] = await updateChannel(id, parsed.data);
  if (!channel) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ channel });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  // Gather storage keys before the cascade delete removes the rows that
  // reference them.
  const storageKeys = await listStorageKeysForChannel(id);

  const [channel] = await deleteChannel(id);
  if (!channel) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The channel is already gone from the DB at this point — R2 cleanup is
  // best-effort and shouldn't fail the request if it errors.
  if (storageKeys.length > 0) {
    try {
      await deleteObjects(storageKeys);
    } catch (err) {
      console.error(`Failed to clean up R2 objects for deleted channel ${id}:`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
