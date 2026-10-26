"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Connection = {
  platform: "youtube" | "instagram";
  accountId: string;
  pageId: string | null;
  expiresAt: string | null;
};

type Channel = {
  id: string;
  name: string;
  ctaTemplate: string | null;
  createdAt: string;
};

function ChannelCard({ channel }: { channel: Channel }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);

  useEffect(() => {
    fetch(`/api/channels/${channel.id}`)
      .then((res) => res.json())
      .then((data) => setConnections(data.connections ?? []));
  }, [channel.id]);

  const youtube = connections?.find((c) => c.platform === "youtube");
  const instagram = connections?.find((c) => c.platform === "instagram");

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-neutral-100">{channel.name}</h2>
        <Link href={`/channels/${channel.id}`} className="text-sm text-neutral-400 hover:text-neutral-200">
          Open channel →
        </Link>
      </div>
      {channel.ctaTemplate && (
        <p className="mt-1 text-sm text-neutral-400">CTA: {channel.ctaTemplate}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <ConnectButton
          label="YouTube"
          connected={Boolean(youtube)}
          accountId={youtube?.accountId}
          href={`/api/oauth/youtube/start?channel_id=${channel.id}`}
        />
        <ConnectButton
          label="Instagram"
          connected={Boolean(instagram)}
          accountId={instagram?.accountId}
          href={`/api/oauth/instagram/start?channel_id=${channel.id}`}
        />
      </div>
    </div>
  );
}

function ConnectButton({
  label,
  connected,
  accountId,
  href,
}: {
  label: string;
  connected: boolean;
  accountId?: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className={`rounded-md border px-3 py-1.5 text-sm ${
        connected
          ? "border-emerald-800 bg-emerald-950 text-emerald-300"
          : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:border-neutral-500"
      }`}
    >
      {connected ? `${label} connected (${accountId})` : `Connect ${label}`}
    </a>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("error");
  const connected = searchParams.get("connected");

  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState("");
  const [ctaTemplate, setCtaTemplate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function dismissOAuthNotice() {
    router.replace("/settings");
  }

  function refresh() {
    fetch("/api/channels")
      .then((res) => res.json())
      .then((data) => setChannels(data.channels ?? []));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ctaTemplate: ctaTemplate.trim() || undefined,
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Failed to create channel");
      return;
    }

    setName("");
    setCtaTemplate("");
    refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-100">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-2 text-neutral-400">
        Create channels and connect each one&apos;s YouTube and Instagram accounts.
      </p>

      {oauthError && (
        <div
          onClick={dismissOAuthNotice}
          className="mt-4 max-w-lg cursor-pointer rounded-md border border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300"
        >
          {oauthError} (click to dismiss)
        </div>
      )}
      {connected && (
        <div
          onClick={dismissOAuthNotice}
          className="mt-4 max-w-lg cursor-pointer rounded-md border border-emerald-900 bg-emerald-950 px-4 py-2 text-sm text-emerald-300"
        >
          {connected === "youtube" ? "YouTube" : "Instagram"} connected. (click to dismiss)
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="mt-6 flex max-w-lg flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Channel name"
          required
          className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
        />
        <input
          value={ctaTemplate}
          onChange={(e) => setCtaTemplate(e.target.value)}
          placeholder="Burned CTA line, e.g. Follow for more BTS (optional)"
          className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="self-start rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create channel"}
        </button>
      </form>

      <div className="mt-8 space-y-4">
        {channels.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} />
        ))}
        {channels.length === 0 && (
          <p className="text-neutral-500">No channels yet — create one above.</p>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
