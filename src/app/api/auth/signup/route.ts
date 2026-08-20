import { createSession, hashPassword, newId, setSessionCookie } from '@/lib/auth';
import { one, run } from '@/lib/pg';
import { getUser, invalidateUserCache } from '@/lib/store';
import { fail, isValidEmail, ok, readJson } from '@/lib/api';
import crypto from 'node:crypto';
import type { Role } from '@/lib/types';

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

// Self-signup covers the working roles; CEO is granted, never claimed.
const VALID_ROLES: Role[] = ['MANAGER', 'TEAM_LEAD', 'DEV'];

interface Body { email?: string; password?: string; name?: string; role?: Role; setupCode?: string }

export async function POST(req: Request) {
  const { email = '', password = '', name = '', role = 'MANAGER', setupCode = '' } =
    await readJson<Body>(req);

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  if (!isValidEmail(cleanEmail)) return fail('Enter a valid email address');
  if (password.length < 8) return fail('Password must be at least 8 characters');
  if (cleanName.length < 2) return fail('Enter your full name');
  if (!VALID_ROLES.includes(role)) return fail('Pick a valid role');

  const taken = await one<{ id: string }>('SELECT id FROM users WHERE email = ?', [cleanEmail]);
  if (taken) return fail('An account with that email already exists');

  const countRow = await one<{ c: number }>('SELECT COUNT(*)::int AS c FROM users');
  const userCount = countRow?.c ?? 0;

  /*
   * The CEO seat is claimed with a setup code from the environment, never by
   * being first through the door — otherwise whoever happened to sign up first
   * would own the workspace.
   */
  const expected = process.env.CEO_SETUP_CODE ?? '';
  let finalRole: Role = role;

  if (setupCode.trim()) {
    if (!expected) {
      return fail('No setup code is configured on this server', 400);
    }
    if (!timingSafeEqualStr(setupCode.trim(), expected)) {
      return fail('That setup code is not valid', 403);
    }
    finalRole = 'CEO';
  }

  const id = newId('u_');
  await run(
    'INSERT INTO users (id, email, name, password_hash, role, avatar_color, title, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [
      id, cleanEmail, cleanName, hashPassword(password), finalRole,
      AVATAR_COLORS[userCount % AVATAR_COLORS.length], null, Date.now(),
    ]
  );

  invalidateUserCache();

  const { token, expiresAt } = await createSession(id);
  await setSessionCookie(token, expiresAt);

  return ok({ user: await getUser(id), isFirstAccount: userCount === 0 }, 201);
}

/** Constant-time compare so the setup code cannot be guessed character by character. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
