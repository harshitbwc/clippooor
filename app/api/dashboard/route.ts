import { NextResponse } from "next/server";
import { listChannelsWithStats } from "@/db/queries";

export async function GET() {
  const channels = await listChannelsWithStats();
  return NextResponse.json({ channels });
}
