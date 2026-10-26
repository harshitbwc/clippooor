import { fromBase64Url, hmacSign, sha256, timingSafeEqual, toBase64Url } from "@/lib/hmac";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Constant-time-ish comparison against APP_PASSWORD, normalized via SHA-256
// so timing doesn't leak the candidate's length.
export async function verifyPassword(candidate: string): Promise<boolean> {
  const expected = requireEnv("APP_PASSWORD");
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  return timingSafeEqual(a, b);
}

// Session token = "<expiresAtMs>.<base64url HMAC-SHA256 signature>".
export async function createSessionToken(): Promise<string> {
  const secret = requireEnv("SESSION_SECRET");
  const expiresAt = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const signature = await hmacSign(expiresAt, secret);
  return `${expiresAt}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [expiresAt, signatureB64] = token.split(".");
  if (!expiresAt || !signatureB64) return false;

  const secret = requireEnv("SESSION_SECRET");
  const expected = await hmacSign(expiresAt, secret);
  let actual: Uint8Array;
  try {
    actual = fromBase64Url(signatureB64);
  } catch {
    return false;
  }
  if (!timingSafeEqual(expected, actual)) return false;

  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;

  return true;
}
