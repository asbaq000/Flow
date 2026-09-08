/**
 * Slack, via an incoming webhook — free, no app review, one URL.
 *
 * A webhook posts to one channel, so this is the team's feed of what moved,
 * not a personal alert: it gets the task lifecycle (raised, assigned,
 * submitted, approved, sent back) and mentions, and deliberately not every
 * chat message, which would bury the channel in noise inside an hour.
 *
 * Configure in .env.local (see .env.example): SLACK_WEBHOOK_URL
 */

const WEBHOOK = process.env.SLACK_WEBHOOK_URL ?? '';

export const slackEnabled = Boolean(WEBHOOK);

/** Which notification types are worth a channel post. */
const CHANNEL_WORTHY = new Set([
  'assigned', 'review_requested', 'approved', 'changes_requested', 'mention', 'meeting',
]);

export function slackWants(type: string): boolean {
  return slackEnabled && CHANNEL_WORTHY.has(type);
}

/** Fire-and-forget. A dead webhook must never fail the request that noticed. */
export async function postToSlack(text: string, link?: string): Promise<void> {
  if (!slackEnabled) return;
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        text: link ? `${text}\n<${link}|Open in Flow>` : text,
      }),
    });
  } catch (err) {
    console.warn('[slack] post failed:', err instanceof Error ? err.message : err);
  }
}
