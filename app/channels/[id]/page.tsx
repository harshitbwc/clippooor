"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SourceVideo = {
  id: string;
  sourceType: "upload" | "youtube_url";
  sourceUrl: string | null;
  storageKey: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

type Channel = {
  id: string;
  name: string;
  ctaTemplate: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  ingesting: "border-neutral-700 bg-neutral-900 text-neutral-300",
  transcribing: "border-amber-800 bg-amber-950 text-amber-300",
  ready: "border-emerald-800 bg-emerald-950 text-emerald-300",
  failed: "border-red-800 bg-red-950 text-red-300",
};

export default function ChannelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [channel, setChannel] = useState<Channel | null>(null);
  const [sourceVideos, setSourceVideos] = useState<SourceVideo[]>([]);
  const [caption, setCaption] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`/api/channels/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setChannel(data.channel);
        setSourceVideos(data.sourceVideos ?? []);
      });
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleYoutubeUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: id,
        source_type: "youtube_url",
        youtube_url: youtubeUrl,
        caption,
      }),
    });
    if (!res.ok) {
      setError("Failed to ingest YouTube URL");
      return;
    }
    setYoutubeUrl("");
    setCaption("");
    refresh();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!caption.trim()) {
      setError("Add a caption before uploading — it's used for every clip from this video.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const presignRes = await fetch("/api/ingest/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: id,
          filename: file.name,
          content_type: file.type || "application/octet-stream",
        }),
      });
      if (!presignRes.ok) throw new Error("Failed to get upload URL");
      const { storageKey, uploadUrl } = await presignRes.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      const ingestRes = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: id,
          source_type: "upload",
          storage_key: storageKey,
          caption,
        }),
      });
      if (!ingestRes.ok) throw new Error("Failed to record upload");

      setCaption("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!channel) {
    return <div className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-400">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{channel.name}</h1>
        <div className="flex gap-3">
          <Link
            href={`/channels/${channel.id}/status`}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500"
          >
            Video status
          </Link>
          <Link
            href={`/channels/${channel.id}/clipped-reels`}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500"
          >
            Clipped Reels →
          </Link>
        </div>
      </div>
      {channel.ctaTemplate && (
        <p className="mt-1 text-neutral-400">CTA: {channel.ctaTemplate}</p>
      )}

      <div className="mt-6 max-w-2xl">
        <label className="block text-sm font-medium text-neutral-300">
          Caption
          <span className="ml-2 font-normal text-neutral-500">
            used as the YouTube description / Instagram caption for every clip from this video
          </span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write the caption once — every Part clipped from this video reuses it."
            rows={2}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
        </label>
      </div>

      <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
        <form
          onSubmit={handleYoutubeUrlSubmit}
          className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
        >
          <h2 className="text-sm font-medium text-neutral-300">Ingest from YouTube URL</h2>
          <input
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            required
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={!caption.trim()}
            className="self-start rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
          >
            Ingest
          </button>
        </form>

        <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-medium text-neutral-300">Upload a video file</h2>
          <input
            type="file"
            accept="video/*"
            disabled={uploading || !caption.trim()}
            onChange={handleFileChange}
            className="text-sm text-neutral-400 disabled:opacity-50"
          />
          {uploading && <p className="text-sm text-neutral-500">Uploading…</p>}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <h2 className="mt-8 text-lg font-medium">Sources</h2>
      <div className="mt-3 space-y-2">
        {sourceVideos.map((sv) => (
          <div
            key={sv.id}
            className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2"
          >
            <div className="text-sm text-neutral-300">
              {sv.sourceType === "youtube_url" ? sv.sourceUrl : sv.storageKey}
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[sv.status] ?? STATUS_COLORS.ingesting}`}
            >
              {sv.status}
            </span>
          </div>
        ))}
        {sourceVideos.length === 0 && (
          <p className="text-neutral-500">No sources yet — ingest one above.</p>
        )}
      </div>
    </div>
  );
}
