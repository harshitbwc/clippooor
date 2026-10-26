import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "clippooor" });

export function sendVideoIngested(sourceVideoId: string) {
  return inngest.send({
    name: "video/ingested",
    data: { sourceVideoId },
  });
}

export function sendClipApproved(clipId: string) {
  return inngest.send({
    name: "clip/approved",
    data: { clipId },
  });
}

export function sendPublishJobCreated(publishJobId: string) {
  return inngest.send({
    name: "publish/job.created",
    data: { publishJobId },
  });
}
