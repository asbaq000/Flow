import { currentUser, hashPassword, verifyPassword } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { getPasswordHash, setPasswordHash } from '@/lib/store';

interface Body {
  current?: string;
  next?: string;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const body = await readJson<Body>(req);
  const current = body.current ?? '';
  const next = body.next ?? '';

  if (next.length < 8) return fail('Use at least 8 characters');
  if (next === current) return fail('That is the password you already have');

  const stored = await getPasswordHash(user.id);
  if (!stored || !verifyPassword(current, stored)) return fail('Your current password is wrong', 403);

  await setPasswordHash(user.id, hashPassword(next));
  // setPasswordHash drops every session including this one; the client signs
  // back in with the new password.
  return ok({ ok: true, signedOut: true });
}
