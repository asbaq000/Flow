import { clearSessionCookie, destroySession, getSessionToken } from '@/lib/auth';
import { ok } from '@/lib/api';

export async function POST() {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  await clearSessionCookie();
  return ok({ ok: true });
}
