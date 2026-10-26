import { NextRequest, NextResponse } from "next/server";
import { listSourceVideoStatusByChannel } from "@/db/queries";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const sourceVideos = await listSourceVideoStatusByChannel(id);
  return NextResponse.json({ sourceVideos });
}
