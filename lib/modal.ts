function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function callModal<T>(path: string, body: unknown): Promise<T> {
  const base = requireEnv("MODAL_RENDER_ENDPOINT").replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("MODAL_WEBHOOK_SECRET")}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Modal ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export type FetchSourceResult = {
  storageKey: string;
  durationMs: number;
};

export async function fetchSource(
  youtubeUrl: string,
  storageKeyPrefix: string,
): Promise<FetchSourceResult> {
  return callModal<FetchSourceResult>("/fetch_source", {
    youtubeUrl,
    storageKeyPrefix,
  });
}

export type TranscriptWord = {
  startMs: number;
  endMs: number;
  word: string;
};

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  words: TranscriptWord[];
};

export type TranscribeResult = {
  segments: TranscriptSegment[];
  durationMs: number;
};

export async function transcribe(storageKey: string): Promise<TranscribeResult> {
  return callModal<TranscribeResult>("/transcribe", { storageKey });
}

export type RenderClipInput = {
  sourceStorageKey: string;
  startMs: number;
  endMs: number;
  partLabel: string;
  ctaText: string | null;
  captions: Array<{ startMs: number; endMs: number; text: string }>;
  outputStorageKey: string;
};

export type RenderClipResult = {
  storageKey: string;
};

export async function renderClip(input: RenderClipInput): Promise<RenderClipResult> {
  return callModal<RenderClipResult>("/render_clip", input);
}
