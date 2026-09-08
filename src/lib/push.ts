import webpush from 'web-push';
import { listPushSubscriptions, removePushSubscription } from './store';
import { appUrl } from './email';

/**
 * Browser push — the alert that reaches someone with the tab closed.
 *
 * Free and account-less: the browser's own push service delivers it, signed
 * with a key pair this install generated once (`npm run push:keys`). Each
 * browser a person says yes in becomes a subscription row; a subscription
 * the push service reports as gone is dropped, so the table does not fill
 * with dead endpoints from old devices.
 *
 * Configure in .env.local (see .env.example):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

export const pushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);
export const pushPublicKey = PUBLIC_KEY;

if (pushEnabled) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap should land. */
  url?: string;
  tag?: string;
}

export interface PushOutcome {
  /** Browsers this person has said yes in. */
  devices: number;
  /** How many of them accepted the push. */
  sent: number;
}

/** Sends to every browser this person has enabled. Never throws; says how it went. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<PushOutcome> {
  if (!pushEnabled) return { devices: 0, sent: 0 };

  const subs = await listPushSubscriptions(userId).catch(() => []);
  if (!subs.length) return { devices: 0, sent: 0 };

  const body = JSON.stringify({ ...payload, url: payload.url ?? `${appUrl}/workspace` });
  let sent = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 60 * 60 * 6 }
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: the browser unsubscribed or the device is gone. Forget it.
      if (status === 404 || status === 410) {
        await removePushSubscription(sub.endpoint).catch(() => {});
      } else {
        console.warn('[push] send failed:', err instanceof Error ? err.message : err);
      }
    }
  }));

  return { devices: subs.length, sent };
}
