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

  // Same message either way so the form cannot be used to enumerate accounts.
  if (!row || !verifyPassword(password, row.password_hash)) {
    return fail('Incorrect email or password', 401);
  }

  const { token, expiresAt } = await createSession(row.id);
  await setSessionCookie(token, expiresAt);

  return ok({ user: await getUser(row.id) });
}
