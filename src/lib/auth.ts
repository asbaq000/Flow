import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { many, one, run } from './pg';
import { newId } from './ids';
import type { User } from './types';

export { newId };

const SESSION_COOKIE = 'flow_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/* ---------- password hashing (scrypt, no external deps) ---------- */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/* ---------- sessions ---------- */

export async function createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await run('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)', [
    token, userId, expiresAt, Date.now(),
  ]);
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await run('DELETE FROM sessions WHERE token = ?', [token]);
}

export async function setSessionCookie(token: string, expiresAt: number) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Resolves the signed-in user, sweeping the session if it has expired. */
export async function currentUser(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const row = await one<User & { _exp: number }>(
    `SELECT u.id, u.org_id, u.email, u.name, u.role, u.avatar_color, u.title, u.created_at,
            s.expires_at AS _exp
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [token]
  );
  if (!row) return null;

  if (row._exp < Date.now()) {
    await destroySession(token);
    return null;
  }
  const { _exp, ...user } = row;
  return user as User;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError('Not signed in', 401);
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/* ---------- role helpers ---------- */

export const isLead = (u: User) => u.role === 'TEAM_LEAD' || u.role === 'CEO';
export const isCeo = (u: User) => u.role === 'CEO';

/**
 * Team Leads own triage, so every new task routes to one. Picks the Lead with
 * the lightest open load, preferring someone other than the person raising it —
 * but a Lead who raises a task keeps it if they are the only Lead.
 */
export async function pickRoutingLead(orgId: string, raisedById?: string): Promise<User | null> {
  const leads = await many<User & { load: number }>(
    `SELECT u.id, u.org_id, u.email, u.name, u.role, u.avatar_color, u.title, u.created_at,
            (SELECT COUNT(*)::int FROM tasks t
             WHERE t.assignee_id = u.id AND t.status != 'DONE' AND t.archived = 0) AS load
     FROM users u WHERE u.role = 'TEAM_LEAD' AND u.org_id = ?
     ORDER BY load ASC, u.created_at ASC`,
    [orgId]
  );

  const others = leads.filter((l) => l.id !== raisedById);
  if (others.length) return others[0];
  if (leads.length) return leads[0];

  // No Team Lead exists yet — fall back to the CEO so work is never orphaned.
  return one<User>(
    `SELECT id, org_id, email, name, role, avatar_color, title, created_at
     FROM users WHERE role = 'CEO' AND org_id = ? ORDER BY created_at ASC LIMIT 1`,
    [orgId]
  );
}
