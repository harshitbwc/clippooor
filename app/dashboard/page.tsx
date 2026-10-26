"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ChannelStats = {
  id: string;
  name: string;
  ctaTemplate: string | null;
  youtubeAuditPending: boolean;
  pendingClips: number;
  failedClips: number;
  postedClips: number;
  failedSourceVideos: number;
  youtubeConnected: boolean;
  instagramConnected: boolean;
};

function ConnectionDot({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-neutral-600"}`}
      />
      {label}
    </span>
  );
}

export default function DashboardPage() {
  const [channels, setChannels] = useState<ChannelStats[] | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => setChannels(data.channels ?? []));
  }, []);

  const auditPendingChannels = channels?.filter((c) => c.youtubeAuditPending) ?? [];
  const anyFailures = channels?.some((c) => c.failedClips > 0 || c.failedSourceVideos > 0);

  return (
    <div className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link
          href="/settings"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500"
        >
          Settings
        </Link>
      </div>

      {auditPendingChannels.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-800 bg-amber-950 px-4 py-3 text-sm text-amber-200">
          <strong>YouTube compliance audit pending</strong> for{" "}
          {auditPendingChannels.map((c) => c.name).join(", ")}. Uploads are succeeding but coming
          back <span className="font-mono">private</span> — YouTube forces this until the API
          Services audit is approved. Videos will switch to public automatically once it&rsquo;s
          approved; no action needed here other than submitting the audit form.
        </div>
      )}
      {anyFailures && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-300">
          One or more channels have failed clips or source videos — open a channel below to see
          details and retry.
        </div>
      )}

      <div className="mt-6 space-y-2">
        {channels?.map((channel) => (
          <Link
            key={channel.id}
            href={`/channels/${channel.id}`}
            className="block rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-neutral-100">{channel.name}</div>
              <div className="flex items-center gap-3">
                <ConnectionDot connected={channel.youtubeConnected} label="YouTube" />
                <ConnectionDot connected={channel.instagramConnected} label="Instagram" />
              </div>
            </div>
            {channel.ctaTemplate && (
              <div className="mt-1 text-sm text-neutral-400">CTA: {channel.ctaTemplate}</div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-sky-800 bg-sky-950 px-2 py-0.5 text-sky-300">
                {channel.pendingClips} pending
              </span>
              <span className="rounded-full border border-emerald-800 bg-emerald-950 px-2 py-0.5 text-emerald-300">
                {channel.postedClips} posted
              </span>
              {(channel.failedClips > 0 || channel.failedSourceVideos > 0) && (
                <span className="rounded-full border border-red-800 bg-red-950 px-2 py-0.5 text-red-300">
                  {channel.failedClips + channel.failedSourceVideos} failed
                </span>
              )}
              {channel.youtubeAuditPending && (
                <span className="rounded-full border border-amber-800 bg-amber-950 px-2 py-0.5 text-amber-300">
                  audit pending
                </span>
              )}
            </div>
          </Link>
        ))}
        {channels?.length === 0 && (
          <p className="text-neutral-500">
            No channels yet —{" "}
            <Link href="/settings" className="underline">
              create one in Settings
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
