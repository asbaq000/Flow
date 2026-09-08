import { createSession, hashPassword, newId, setSessionCookie } from '@/lib/auth';
import { one, run } from '@/lib/pg';
import { createOrganization, findOrganizationByInvite, firstOrganization, getUser, invalidateUserCache } from '@/lib/store';
import { fail, isValidEmail, ok, readJson } from '@/lib/api';
import crypto from 'node:crypto';
import type { Role } from '@/lib/types';

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

// Self-signup covers the working roles; CEO comes from founding an organisation.
const VALID_ROLES: Role[] = ['MANAGER', 'TEAM_LEAD', 'DEV'];

interface Body {
  email?: string;
  password?: string;
  name?: string;
  role?: Role;
  /** Founding a new organisation. The founder is its CEO. */
  orgName?: string;
  /** Joining an existing one, in the role chosen. */
  inviteCode?: string;
  /** Legacy: claims the CEO seat of the first organisation on this install. */
  setupCode?: string;
}

/**
 * Three ways in, and every one of them lands the account in exactly one
 * organisation:
 *   - orgName    → a new organisation is created and this person is its CEO.
 *   - inviteCode → joins the organisation that code belongs to, in the role
 *                  chosen, never as CEO.
 *   - setupCode  → the pre-organisation way of claiming the CEO seat; kept so
 *                  an install upgraded in place still bootstraps the same way.
 * Nobody signs up into nothing: with none of the three, the request is refused
 * and the form says what is missing.
 */
export async function POST(req: Request) {
  const {
    email = '', password = '', name = '', role = 'MANAGER',
    orgName = '', inviteCode = '', setupCode = '',
  } = await readJson<Body>(req);

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  if (!isValidEmail(cleanEmail)) return fail('Enter a valid email address');
  if (password.length < 8) return fail('Password must be at least 8 characters');
  if (cleanName.length < 2) return fail('Enter your full name');

  const taken = await one<{ id: string }>('SELECT id FROM users WHERE email = ?', [cleanEmail]);
  if (taken) return fail('An account with that email already exists');

  let orgId: string;
  let finalRole: Role;

  if (orgName.trim()) {
    if (orgName.trim().length < 2) return fail('Give your organisation a name');
    const org = await createOrganization(orgName.trim().slice(0, 80));
    orgId = org.id;
    finalRole = 'CEO';
  } else if (inviteCode.trim()) {
    const org = await findOrganizationByInvite(inviteCode.trim());
    if (!org) return fail('That invite code is not valid', 403);
    if (!VALID_ROLES.includes(role)) return fail('Pick a valid role');
    orgId = org.id;
    finalRole = role;
  } else if (setupCode.trim()) {
    const expected = process.env.CEO_SETUP_CODE ?? '';
    if (!expected) return fail('No setup code is configured on this server', 400);
    if (!timingSafeEqualStr(setupCode.trim(), expected)) return fail('That setup code is not valid', 403);
    const org = await firstOrganization();
    if (!org) return fail('No organisation exists yet — create one instead', 400);
    orgId = org.id;
    finalRole = 'CEO';
  } else {
    return fail('Enter your organisation\'s invite code, or create a new organisation', 400);
  }

  const countRow = await one<{ c: number }>('SELECT COUNT(*)::int AS c FROM users WHERE org_id = ?', [orgId]);
  const userCount = countRow?.c ?? 0;

  const id = newId('u_');
  await run(
    `INSERT INTO users (id, org_id, email, name, password_hash, role, avatar_color, title, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id, orgId, cleanEmail, cleanName, hashPassword(password), finalRole,
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
