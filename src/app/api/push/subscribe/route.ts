import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { addPushSubscription, removePushSubscription } from '@/lib/store';
import { pushEnabled } from '@/lib/push';

interface Body {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);
  if (!pushEnabled) return fail('Push is not set up on this install', 400);

  const body = await readJson<Body>(req);
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) return fail('That is not a push subscription');

  await addPushSubscription(user.id, { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth });
  return ok({ ok: true }, 201);
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const body = await readJson<Body>(req);
  if (body.endpoint) await removePushSubscription(body.endpoint);
  return ok({ ok: true });
}
