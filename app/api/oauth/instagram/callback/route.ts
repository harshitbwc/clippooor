import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { verifyOAuthState } from "@/lib/oauth-state";
import { connectInstagramAccount } from "@/lib/instagram";
import { upsertConnection } from "@/db/queries";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError =
    req.nextUrl.searchParams.get("error") ?? req.nextUrl.searchParams.get("error_message");

  if (oauthError) {
    return redirectWithError(req, `Meta denied access: ${oauthError}`);
  }

  const channelId = await verifyOAuthState(state);
  if (!channelId || !code) {
    return redirectWithError(req, "Invalid or expired OAuth state");
  }

  try {
    const result = await connectInstagramAccount(code);

    await upsertConnection({
      channelId,
      platform: "instagram",
      accountId: result.igUserId,
      pageId: result.pageId,
      accessTokenEnc: encrypt(result.pageAccessToken),
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    return redirectWithError(
      req,
      err instanceof Error ? err.message : "Instagram connect failed",
    );
  }

  return NextResponse.redirect(new URL("/settings?connected=instagram", req.url));
}

function redirectWithError(req: NextRequest, message: string) {
  const url = new URL("/settings", req.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}
