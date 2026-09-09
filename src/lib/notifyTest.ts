import { appUrl, emailEnabled, sendMailDetailed } from './email';
import { pushEnabled, pushToUser } from './push';
import { postToSlack, slackEnabled } from './slack';
import { notify } from './store';
import { timeForUser } from './clock';
import type { NotificationTestResult, User } from './types';

/**
 * One test on every channel, each reported separately.
 *
 * Deliberately not routed through notify()'s fan-out: that fires push and
 * Slack without waiting to hear back, which is right for real alerts and
 * useless for a test. Here each channel is called directly and asked how it
 * went, so the profile page can say "email sent, no device has push on yet"
 * instead of "something probably happened".
 */
export async function testNotificationChannels(user: User): Promise<NotificationTestResult> {
  const when = timeForUser(user, Date.now());
  const text = `Test notification for ${user.name} at ${when} — this channel works.`;
  const url = `${appUrl}/workspace`;

  let inApp = false;
  try {
    await notify(user.id, null, 'test', null, null, text, { quiet: true });
    inApp = true;
  } catch (err) {
    console.warn('[notify-test] in-app failed:', err instanceof Error ? err.message : err);
  }

  const email = emailEnabled
    ? await sendMailDetailed({
        to: user.email,
        subject: 'Flow test notification',
        heading: 'This channel works',
        body: `${text}\n\nYou asked for this from your profile page. Real notifications — assignments, mentions, reviews — arrive the same way.`,
        action: { label: 'Open Flow', url },
        footer: 'You are receiving this because you sent yourself a test from Flow.',
      })
    : { ok: false, error: 'SMTP is not configured on this server' };

  const push = pushEnabled
    ? await pushToUser(user.id, { title: 'Flow test notification', body: text, url, tag: 'test' })
    : { devices: 0, sent: 0 };

  const slack = slackEnabled ? await postToSlack(`${text} (sent by ${user.name})`, url) : false;

  return {
    inApp: { ok: inApp },
    email: { configured: emailEnabled, ok: email.ok, error: email.error, route: email.route, to: user.email },
    push: { configured: pushEnabled, devices: push.devices, sent: push.sent, ok: push.sent > 0 },
    slack: { configured: slackEnabled, ok: slack },
  };
}
