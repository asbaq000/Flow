import { createSession, setSessionCookie, verifyPassword } from '@/lib/auth';
import { one } from '@/lib/pg';
import { getUser } from '@/lib/store';
import { fail, ok, readJson } from '@/lib/api';

interface Body { email?: string; password?: string }

export async function POST(req: Request) {
  const { email = '', password = '' } = await readJson<Body>(req);
  const cleanEmail = email.trim().toLowerCase();

  const row = await one<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email = ?',
    [cleanEmail]
  );

  /*
   * Named separately, because being told "email or password" when you have
   * simply mistyped one of them helps nobody. The trade is that the form can
   * now be used to check whether an address has an account here; for a
   * workspace whose members already know each other that is a fair swap for
   * an error message that says what to fix.
   */
  if (!row) return fail('No account found with that email', 401);
  if (!verifyPassword(password, row.password_hash)) return fail('Wrong password', 401);

  const { token, expiresAt } = await createSession(row.id);
  await setSessionCookie(token, expiresAt);

  return ok({ user: await getUser(row.id) });
}
