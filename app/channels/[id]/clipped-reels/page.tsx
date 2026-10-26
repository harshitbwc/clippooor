"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SourceVideo = {
  id: string;
  sourceType: "upload" | "youtube_url";
  sourceUrl: string | null;
  storageKey: string | null;
};

type ClippedReel = {
  id: string;
  sourceVideoId: string;
  partNumber: number;
  startMs: number;
  endMs: number;
  status: string;
  error: string | null;
  sourceType: "upload" | "youtube_url";
  sourceUrl: string | null;
  storageKey: string | null;
  caption: string | null;
  scheduledAt: string | null;
  createdAt: string;
  previewUrl: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "border-neutral-700 bg-neutral-900 text-neutral-300",
  approved: "border-amber-800 bg-amber-950 text-amber-300",
  rendered: "border-sky-800 bg-sky-950 text-sky-300",
  scheduled: "border-sky-800 bg-sky-950 text-sky-300",
  failed: "border-red-800 bg-red-950 text-red-300",
};

function msToClock(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Not yet scheduled";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ReelCard({
  reel,
  deleting,
  retrying,
  onDelete,
  onRetry,
}: {
  reel: ClippedReel;
  deleting: boolean;
  retrying: boolean;
  onDelete: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="relative aspect-[9/16] w-full bg-black">
        {reel.previewUrl ? (
          <video
            src={reel.previewUrl}
            controls
            preload="metadata"
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-3 text-center text-sm text-neutral-500">
            {reel.status === "failed" ? "Render failed" : "Rendering…"}
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-neutral-200">Part {reel.partNumber}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[reel.status] ?? STATUS_COLORS.draft}`}
          >
            {reel.status}
          </span>
        </div>
        {reel.error && <p className="mt-1 text-xs text-red-400">{reel.error}</p>}

        <div className="mt-2 text-xs text-neutral-400">
          {msToClock(reel.startMs)}–{msToClock(reel.endMs)}
        </div>

        <div className="mt-1 truncate text-xs text-neutral-500">
          {reel.sourceType === "youtube_url" && reel.sourceUrl ? (
            <a
              href={reel.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline"
            >
              {reel.sourceUrl}
            </a>
          ) : (
            reel.caption || reel.storageKey || "Uploaded video"
          )}
        </div>

        <div className="mt-1 text-xs text-neutral-500">{formatDateTime(reel.scheduledAt)}</div>

        <div className="mt-3 flex items-center justify-between">
          {reel.previewUrl ? (
            <a
              href={reel.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-400 hover:underline"
            >
              Open in new tab ↗
            </a>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {reel.status === "failed" && (
              <button
                onClick={onRetry}
                disabled={retrying}
                className="text-xs text-sky-400 hover:underline disabled:opacity-50"
              >
                {retrying ? "Retrying…" : "Retry"}
              </button>
            )}
            <button
              onClick={onDelete}
              disabled={deleting}
              className="text-xs text-red-400 hover:underline disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddClipForm({
  channelId,
  sourceVideos,
  onAdded,
}: {
  channelId: string;
  sourceVideos: SourceVideo[];
  onAdded: () => void;
}) {
  const [sourceVideoId, setSourceVideoId] = useState("");
  const [startS, setStartS] = useState("0");
  const [endS, setEndS] = useState("45");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSourceVideoId = sourceVideoId || sourceVideos[0]?.id || "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/channels/${channelId}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_video_id: effectiveSourceVideoId,
        start_ms: Math.round(parseFloat(startS || "0") * 1000),
        end_ms: Math.round(parseFloat(endS || "0") * 1000),
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Failed to add part (check the time range is under 90s)");
      return;
    }
    onAdded();
  }

  if (sourceVideos.length === 0) return null;

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
    >
      <label className="text-xs text-neutral-400">
        Source video
        <select
          value={effectiveSourceVideoId}
          onChange={(e) => setSourceVideoId(e.target.value)}
          className="mt-1 block rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
        >
          {sourceVideos.map((sv) => (
            <option key={sv.id} value={sv.id}>
              {sv.sourceUrl ?? sv.storageKey ?? sv.id}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-neutral-400">
        Start (s)
        <input
          type="number"
          step="0.1"
          min="0"
          value={startS}
          onChange={(e) => setStartS(e.target.value)}
          className="mt-1 block w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
        />
      </label>
      <label className="text-xs text-neutral-400">
        End (s)
        <input
          type="number"
          step="0.1"
          min="0"
          value={endS}
          onChange={(e) => setEndS(e.target.value)}
          className="mt-1 block w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
        />
      </label>
      <button
        type="submit"
        disabled={submitting || !effectiveSourceVideoId}
        className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add part"}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </form>
  );
}

export default function ClippedReelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: channelId } = use(params);

  const [sourceVideos, setSourceVideos] = useState<SourceVideo[]>([]);
  const [reels, setReels] = useState<ClippedReel[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`/api/channels/${channelId}`)
      .then((res) => res.json())
      .then((data) => setSourceVideos(data.sourceVideos ?? []));
    fetch(`/api/channels/${channelId}/clips`)
      .then((res) => res.json())
      .then((data) => setReels(data.clips ?? []));
  }, [channelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch(`/api/clips/${id}`, { method: "DELETE" });
    setDeletingId(null);
    refresh();
  }

  async function handleRetry(id: string) {
    setRetryingId(id);
    await fetch(`/api/clips/${id}/approve`, { method: "POST" });
    setRetryingId(null);
    refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clipped Reels</h1>
        <Link
          href={`/channels/${channelId}/status`}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500"
        >
          Video status →
        </Link>
      </div>
      <p className="mt-2 text-neutral-400">
        Every reel clipped from your videos — rendering and scheduling happen automatically, no
        approval needed. Posted reels move to Video status.
      </p>

      <div className="mt-6">
        <AddClipForm channelId={channelId} sourceVideos={sourceVideos} onAdded={refresh} />
      </div>

      {reels.length === 0 ? (
        <p className="text-neutral-500">No reels yet — ingest a video to get parts automatically.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {reels.map((reel) => (
            <ReelCard
              key={reel.id}
              reel={reel}
              deleting={deletingId === reel.id}
              retrying={retryingId === reel.id}
              onDelete={() => handleDelete(reel.id)}
              onRetry={() => handleRetry(reel.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
