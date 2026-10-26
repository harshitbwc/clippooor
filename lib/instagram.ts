import { decrypt, encrypt } from "@/lib/crypto";
import { getConnection, upsertConnection } from "@/db/queries";

const GRAPH_VERSION = "v21.0";
// META_GRAPH_BASE_URL is an internal override for local testing against an
// emulator; production always uses the real Graph API.
const GRAPH_BASE = process.env.META_GRAPH_BASE_URL ?? `https://graph.facebook.com/${GRAPH_VERSION}`;
const OAUTH_DIALOG_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Meta Graph API error on ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function graphPost<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    throw new Error(`Meta Graph API error on ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("META_APP_ID"),
    redirect_uri: requireEnv("META_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  });
  return `${OAUTH_DIALOG_URL}?${params.toString()}`;
}

async function exchangeCodeForUserToken(code: string): Promise<string> {
  const data = await graphGet<{ access_token: string }>("/oauth/access_token", {
    client_id: requireEnv("META_APP_ID"),
    client_secret: requireEnv("META_APP_SECRET"),
    redirect_uri: requireEnv("META_REDIRECT_URI"),
    code,
  });
  return data.access_token;
}

// Exchanges a short-lived (or still-valid long-lived) user token for a
// long-lived one (~60 days). Meta also uses this same call to extend an
// existing long-lived token, which doubles as our "refresh" mechanism.
async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const data = await graphGet<{ access_token: string; expires_in: number }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: requireEnv("META_APP_ID"),
      client_secret: requireEnv("META_APP_SECRET"),
      fb_exchange_token: shortLivedToken,
    },
  );
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

type Page = { id: string; name: string; access_token: string };

async function getPages(userAccessToken: string): Promise<Page[]> {
  const data = await graphGet<{ data: Page[] }>("/me/accounts", {
    access_token: userAccessToken,
  });
  return data.data;
}

async function getInstagramBusinessAccountId(
  pageId: string,
  pageAccessToken: string,
): Promise<string | null> {
  const data = await graphGet<{ instagram_business_account?: { id: string } }>(`/${pageId}`, {
    fields: "instagram_business_account",
    access_token: pageAccessToken,
  });
  return data.instagram_business_account?.id ?? null;
}

export type InstagramConnectionResult = {
  igUserId: string;
  pageId: string;
  pageAccessToken: string;
  expiresAt: Date | null;
};

// Full OAuth callback flow: code -> long-lived user token -> first Page with
// a linked IG Business account -> that Page's access token.
export async function connectInstagramAccount(code: string): Promise<InstagramConnectionResult> {
  const shortLivedToken = await exchangeCodeForUserToken(code);
  const { accessToken: longLivedUserToken, expiresIn } =
    await exchangeForLongLivedToken(shortLivedToken);

  const pages = await getPages(longLivedUserToken);
  if (pages.length === 0) {
    throw new Error("No Facebook Pages found for this account");
  }

  for (const page of pages) {
    const igUserId = await getInstagramBusinessAccountId(page.id, page.access_token);
    if (igUserId) {
      return {
        igUserId,
        pageId: page.id,
        pageAccessToken: page.access_token,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
    }
  }

  throw new Error(
    "None of this account's Facebook Pages have a linked Instagram Business account",
  );
}

// Returns a usable access token for the channel's Instagram connection,
// extending it first if it's within 7 days of expiring.
export async function getValidAccessToken(channelId: string): Promise<string> {
  const connection = await getConnection(channelId, "instagram");
  if (!connection) {
    throw new Error(`No Instagram connection for channel ${channelId}`);
  }

  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  const isExpiringSoon = expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000;
  if (!isExpiringSoon) {
    return decrypt(connection.accessTokenEnc);
  }

  const currentToken = decrypt(connection.accessTokenEnc);
  const { accessToken, expiresIn } = await exchangeForLongLivedToken(currentToken);

  await upsertConnection({
    channelId,
    platform: "instagram",
    accountId: connection.accountId,
    pageId: connection.pageId,
    accessTokenEnc: encrypt(accessToken),
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  });

  return accessToken;
}

// Step 1 of 3: create a Reels media container. Instagram fetches the video
// itself from videoUrl (must be publicly readable) — no upload from us.
export async function createReelContainer(input: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
}): Promise<{ containerId: string }> {
  const data = await graphPost<{ id: string }>(`/${input.igUserId}/media`, {
    media_type: "REELS",
    video_url: input.videoUrl,
    caption: input.caption,
    share_to_feed: "true",
    access_token: input.accessToken,
  });
  return { containerId: data.id };
}

// Step 2 of 3: poll until Instagram has finished processing the container.
export async function getContainerStatus(
  containerId: string,
  accessToken: string,
): Promise<string> {
  const data = await graphGet<{ status_code: string }>(`/${containerId}`, {
    fields: "status_code",
    access_token: accessToken,
  });
  return data.status_code;
}

// Step 3 of 3: publish the finished container to the account.
export async function publishReelContainer(
  igUserId: string,
  containerId: string,
  accessToken: string,
): Promise<{ mediaId: string }> {
  const data = await graphPost<{ id: string }>(`/${igUserId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });
  return { mediaId: data.id };
}
