import type { TranscriptSegment } from "@/lib/modal";

export type RelativeCaption = {
  startMs: number;
  endMs: number;
  text: string;
};

// Slices whisper transcript segments to a clip's [startMs, endMs) window and
// rebases timestamps to be relative to the clip's own start, for burning
// into the rendered clip via an .ass subtitle track.
export function buildRelativeCaptions(
  transcript: unknown,
  clipStartMs: number,
  clipEndMs: number,
): RelativeCaption[] {
  const segments = Array.isArray(transcript) ? (transcript as TranscriptSegment[]) : [];

  return segments
    .filter((seg) => seg.endMs > clipStartMs && seg.startMs < clipEndMs)
    .map((seg) => ({
      startMs: Math.max(seg.startMs, clipStartMs) - clipStartMs,
      endMs: Math.min(seg.endMs, clipEndMs) - clipStartMs,
      text: seg.text,
    }));
}
