import { NextRequest, NextResponse } from "next/server";
import { getClip, listPublishJobsByClip, updateClip, updatePublishJob } from "@/db/queries";
import { sendClipApproved, sendPublishJobCreated } from "@/inngest/client";

type Params = { params: Promise<{ id: string }> };

// Doubles as the retry endpoint for failed clips. A clip with no render_key
// yet failed during rendering — re-run the whole clip/approved pipeline. A
// clip that already has a render_key failed during publish — only resend
// the publish_jobs that actually failed, so a platform that already posted
// successfully doesn't get double-published.
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const existing = await getClip(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.renderKey) {
    const jobs = await listPublishJobsByClip(id);
    const failedJobs = jobs.filter((j) => j.status === "failed");
    await Promise.all(failedJobs.map((j) => updatePublishJob(j.id, { status: "pending", error: null })));
    const [clip] = await updateClip(id, { status: "scheduled", error: null });
    for (const job of failedJobs) {
      await sendPublishJobCreated(job.id);
    }
    return NextResponse.json({ clip });
  }

  const [clip] = await updateClip(id, { status: "approved", error: null });
  await sendClipApproved(clip.id);

  return NextResponse.json({ clip });
}
