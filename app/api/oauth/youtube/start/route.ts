import { NextRequest, NextResponse } from "next/server";
import { getChannel } from "@/db/queries";
import { getAuthorizationUrl } from "@/lib/youtube";
import { createOAuthState } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get("channel_id");
  if (!channelId) {
    return NextResponse.json({ error: "channel_id is required" }, { status: 400 });
  }

  const channel = await getChannel(channelId);
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const state = await createOAuthState(channelId);
  return NextResponse.redirect(getAuthorizationUrl(state));
}
