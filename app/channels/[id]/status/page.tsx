"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ClipStatus = {
  id: string;
  partNumber: number;
  status: string;
  postedAt: string | null;
};

type SourceVideoStatus = {
  id: string;
  sourceType: "upload" | "youtube_url";
  sourceUrl: string | null;
  storageKey: string | null;
  caption: string | null;
  createdAt: string;
  totalParts: number;
  postedCount: number;
  pendingCount: number;
  clips: ClipStatus[];
};

const STATUS_COLORS: Record<string, string> = {
  draft: "border-neutral-700 bg-neutral-900 text-neutral-300",
  approved: "border-amber-800 bg-amber-950 text-amber-300",
  rendered: "border-sky-800 bg-sky-950 text-sky-300",
  scheduled: "border-sky-800 bg-sky-950 text-sky-300",
  posted: "border-emerald-800 bg-emerald-950 text-emerald-300",
  failed: "border-red-800 bg-red-950 text-red-300",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function StatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: channelId } = use(params);
  const [sourceVideos, setSourceVideos] = useState<SourceVideoStatus[] | null>(null);

  const refresh = useCallback(() => {
    fetch(`/api/channels/${channelId}/status`)
      .then((res) => res.json())
      .then((data) => setSourceVideos(data.sourceVideos ?? []));
  }, [channelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Video status</h1>
        <div className="flex gap-3">
          <Link
            href={`/channels/${channelId}`}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500"
          >
            ← Channel
          </Link>
          <Link
            href={`/channels/${channelId}/clipped-reels`}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500"
          >
            Clipped Reels
          </Link>
        </div>
      </div>
      <p className="mt-2 text-neutral-400">
        Every source video and how many of its parts have been posted.
      </p>

      <div className="mt-8 overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-medium">Video</th>
              <th className="px-4 py-3 font-medium">Parts</th>
              <th className="px-4 py-3 font-medium">Posted</th>
              <th className="px-4 py-3 font-medium">Pending</th>
              <th className="px-4 py-3 font-medium">Per-part status</th>
            </tr>
          </thead>
          <tbody>
            {sourceVideos?.map((sv) => (
              <tr key={sv.id} className="border-t border-neutral-800 align-top">
                <td className="max-w-[240px] px-4 py-3">
                  <div className="truncate text-neutral-200">
                    {sv.caption || sv.sourceUrl || sv.storageKey || sv.id}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {new Date(sv.createdAt).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-300">{sv.totalParts}</td>
                <td className="px-4 py-3 text-emerald-400">{sv.postedCount}</td>
                <td className="px-4 py-3 text-amber-400">{sv.pendingCount}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1.5">
                    {sv.clips.map((clip) => (
                      <div key={clip.id} className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[clip.status] ?? STATUS_COLORS.draft}`}
                        >
                          Part {clip.partNumber}: {clip.status}
                        </span>
                        {clip.status === "posted" && (
                          <span className="text-xs text-neutral-500">
                            {formatDateTime(clip.postedAt)}
                          </span>
                        )}
                      </div>
                    ))}
                    {sv.clips.length === 0 && (
                      <span className="text-xs text-neutral-600">No parts yet</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {sourceVideos?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                  No source videos yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
