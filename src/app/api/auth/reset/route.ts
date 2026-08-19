import { hashPassword } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { consumePasswordReset } from '@/lib/store';

export async function POST(req: Request) {
  const { token = '', password = '' } = await readJson<{ token?: string; password?: string }>(req);

  if (!token.trim()) return fail('That reset link is missing its token');
  if (password.length < 8) return fail('Password must be at least 8 characters');

  const done = await consumePasswordReset(token.trim(), hashPassword(password));
  if (!done) return fail('That link has expired or was already used. Request a new one.', 400);

  return ok({ ok: true });
}
