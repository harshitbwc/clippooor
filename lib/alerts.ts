// Sends a failure alert to ALERT_WEBHOOK_URL. The payload carries both `text`
// (Slack) and `content` (Discord) so either kind of incoming webhook works.
// Alerting is best-effort: it never throws, and it's a no-op when unset.
export async function sendAlert(message: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
    });
    if (!res.ok) {
      console.error(`Alert webhook responded ${res.status}`);
    }
  } catch (err) {
    console.error("Failed to send alert:", err);
  }
}
