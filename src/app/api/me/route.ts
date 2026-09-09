import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { getUser, setUserTimeZone } from '@/lib/store';

export async function GET() {
  const user = await currentUser();
  return ok({ user });
}

/**
 * The browser telling us where it is. Sent once on load, and again only if it
 * changes — somebody who has flown somewhere gets their times in the clock
 * they are actually reading them in.
 */
export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { timeZone } = await readJson<{ timeZone?: string }>(req);
  if (typeof timeZone !== 'string' || !timeZone.trim()) return fail('Send a time zone');

  // Anything Intl does not recognise is not a zone, whatever it claims to be.
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
  } catch {
    return fail('That is not a time zone this server knows');
  }

  await setUserTimeZone(user.id, timeZone.slice(0, 64));
  return ok({ user: await getUser(user.id) });
}
