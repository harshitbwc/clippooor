import { fromBase64Url, hmacSign, timingSafeEqual, toBase64Url } from "@/lib/hmac";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — just long enough for the consent flow

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Signed state = "<channelId>.<expiresAtMs>.<signature>", so the OAuth
// callback can trust which channel initiated the flow without a server-side
// session store.
export async function createOAuthState(channelId: string): Promise<string> {
  const secret = requireEnv("SESSION_SECRET");
  const expiresAt = String(Date.now() + STATE_MAX_AGE_MS);
  const payload = `${channelId}.${expiresAt}`;
  const signature = await hmacSign(payload, secret);
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifyOAuthState(state: string | null): Promise<string | null> {
  if (!state) return null;
  const [channelId, expiresAt, signatureB64] = state.split(".");
  if (!channelId || !expiresAt || !signatureB64) return null;

  const secret = requireEnv("SESSION_SECRET");
  const expected = await hmacSign(`${channelId}.${expiresAt}`, secret);
  let actual: Uint8Array;
  try {
    actual = fromBase64Url(signatureB64);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, actual)) return null;

  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;

  return channelId;
}
