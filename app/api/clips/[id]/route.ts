import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteClip, getClip, updateClip } from "@/db/queries";
import { deleteObject } from "@/lib/r2";

const MAX_CLIP_DURATION_MS = 90_000;

const updateClipSchema = z
  .object({
    start_ms: z.number().int().nonnegative().optional(),
    end_ms: z.number().int().positive().optional(),
  })
  .refine(
    (data) =>
      data.start_ms === undefined || data.end_ms === undefined || data.end_ms > data.start_ms,
    { message: "end_ms must be greater than start_ms", path: ["end_ms"] },
  );

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const clip = await getClip(id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ clip });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateClipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await getClip(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nextStart = parsed.data.start_ms ?? existing.startMs;
  const nextEnd = parsed.data.end_ms ?? existing.endMs;
  if (nextEnd - nextStart > MAX_CLIP_DURATION_MS) {
    return NextResponse.json(
      { error: "Clips must be 90 seconds or shorter" },
      { status: 400 },
    );
  }

  const [clip] = await updateClip(id, {
    startMs: parsed.data.start_ms,
    endMs: parsed.data.end_ms,
  });

  return NextResponse.json({ clip });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const [clip] = await deleteClip(id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The clip row is already gone — R2 cleanup is best-effort and shouldn't
  // fail the request if it errors.
  if (clip.renderKey) {
    try {
      await deleteObject(clip.renderKey);
    } catch (err) {
      console.error(`Failed to clean up R2 object for deleted clip ${id}:`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
