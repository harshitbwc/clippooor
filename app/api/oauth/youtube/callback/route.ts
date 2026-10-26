import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { verifyOAuthState } from "@/lib/oauth-state";
import { exchangeCodeForTokens, getMyChannel } from "@/lib/youtube";
import { upsertConnection } from "@/db/queries";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    return redirectWithError(req, `Google denied access: ${oauthError}`);
  }

  const channelId = await verifyOAuthState(state);
  if (!channelId || !code) {
    return redirectWithError(req, "Invalid or expired OAuth state");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token — revoke access at https://myaccount.google.com/permissions and try connecting again",
      );
    }
    const channel = await getMyChannel(tokens.access_token);

    await upsertConnection({
      channelId,
      platform: "youtube",
      accountId: channel.id,
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    });
  } catch (err) {
    return redirectWithError(req, err instanceof Error ? err.message : "YouTube connect failed");
  }

  return NextResponse.redirect(new URL("/settings?connected=youtube", req.url));
}

function redirectWithError(req: NextRequest, message: string) {
  const url = new URL("/settings", req.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}
