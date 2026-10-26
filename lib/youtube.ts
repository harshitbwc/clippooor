import type { Readable } from "node:stream";
import { auth, youtube as youtubeClient } from "@googleapis/youtube";
import { decrypt, encrypt } from "@/lib/crypto";
import { getConnection, upsertConnection } from "@/db/queries";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`YouTube token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`YouTube token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getMyChannel(
  accessToken: string,
): Promise<{ id: string; title: string }> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(`YouTube channels.list failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) {
    throw new Error("No YouTube channel found for this Google account");
  }
  return { id: item.id, title: item.snippet.title };
}

// Returns a valid (non-expired) access token for the channel's YouTube
// connection, refreshing and persisting a new one if the current one is
// expired or about to expire.
export async function getValidAccessToken(channelId: string): Promise<string> {
  const connection = await getConnection(channelId, "youtube");
  if (!connection) {
    throw new Error(`No YouTube connection for channel ${channelId}`);
  }

  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  const isExpiringSoon = expiresAt - Date.now() < 60_000;
  if (!isExpiringSoon) {
    return decrypt(connection.accessTokenEnc);
  }

  if (!connection.refreshTokenEnc) {
    throw new Error(`YouTube connection for channel ${channelId} has no refresh token`);
  }

  const refreshToken = decrypt(connection.refreshTokenEnc);
  const tokens = await refreshAccessToken(refreshToken);

  await upsertConnection({
    channelId,
    platform: "youtube",
    accountId: connection.accountId,
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: connection.refreshTokenEnc,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  });

  return tokens.access_token;
}

// Uploads a video via the resumable protocol (handled internally by the
// googleapis client). YouTube classifies a vertical, short video as a Short
// automatically — no separate "Shorts" upload endpoint exists.
export async function uploadVideo(input: {
  accessToken: string;
  videoStream: Readable;
  title: string;
  description: string;
}): Promise<{ videoId: string; privacyStatus: string | null }> {
  const oauth2Client = new auth.OAuth2();
  oauth2Client.setCredentials({ access_token: input.accessToken });
  const youtube = youtubeClient({ version: "v3", auth: oauth2Client });

  const res = await youtube.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: input.title,
          description: input.description,
        },
        status: {
          // Uploads from an unaudited API project are forced private by
          // YouTube regardless of this value — see §11 of the build spec.
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        mimeType: "video/mp4",
        body: input.videoStream,
      },
    },
    // YOUTUBE_API_ROOT_URL is an internal override for local testing
    // against an emulator; production always uses the real YouTube API.
    // The generated client only honors rootUrl from this second "options"
    // argument for upload methods, not from client-construction options.
    { rootUrl: process.env.YOUTUBE_API_ROOT_URL },
  );

  if (!res.data.id) {
    throw new Error("YouTube videos.insert did not return a video id");
  }
  return { videoId: res.data.id, privacyStatus: res.data.status?.privacyStatus ?? null };
}
