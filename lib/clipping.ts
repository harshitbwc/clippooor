export type ClipRange = { startMs: number; endMs: number };

export const CLIP_CHUNK_MS = 45_000;
const MIN_TAIL_MS = 20_000;

// Mechanically splits a source video into fixed 45s parts. The final,
// possibly-shorter part is kept only if it's at least 20s; otherwise it's
// dropped rather than published as a near-empty clip.
export function computeClipRanges(durationMs: number): ClipRange[] {
  const ranges: ClipRange[] = [];
  let start = 0;
  while (start < durationMs) {
    const remaining = durationMs - start;
    const len = Math.min(CLIP_CHUNK_MS, remaining);
    if (len < MIN_TAIL_MS) break;
    ranges.push({ startMs: start, endMs: start + len });
    start += len;
  }
  return ranges;
}
