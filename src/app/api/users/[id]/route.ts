import { currentUser } from '@/lib/auth';
import { one, run } from '@/lib/pg';
import { fail, ok, readJson } from '@/lib/api';
import { getUser, invalidateUserCache, removeUser } from '@/lib/store';
import { canManageUsers, canRemoveUser, whyCannotRemove } from '@/lib/permissions';
import type { Role } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };
const VALID_ROLES: Role[] = ['CEO', 'MANAGER', 'TEAM_LEAD', 'DEV'];

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);
  if (!canManageUsers(user)) return fail('Only the CEO can change roles', 403);

  const { id } = await params;
  const target = await getUser(id);
  if (!target || target.org_id !== user.org_id) return fail('User not found', 404);

  const { role, title } = await readJson<{ role?: Role; title?: string }>(req);

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role)) return fail('Not a valid role');
    // Never let the last CEO demote themselves out of the workspace.
    if (target.role === 'CEO' && role !== 'CEO') {
      const row = await one<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM users WHERE role = 'CEO' AND org_id = ?", [user.org_id]
      );
      if ((row?.c ?? 0) <= 1) return fail('The workspace needs at least one CEO');
    }
    await run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  }
  if (title !== undefined) {
    await run('UPDATE users SET title = ? WHERE id = ?', [title.trim().slice(0, 60) || null, id]);
  }
  invalidateUserCache();

  return ok({ user: await getUser(id) });
}

/**
 * Offboards someone who has left. Their work history is preserved — see
 * removeUser() — and anything still open is routed back to a Team Lead.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const target = await getUser(id);
  if (!target || target.org_id !== user.org_id) return fail('User not found', 404);

  if (!canRemoveUser(user, target)) {
    return fail(whyCannotRemove(user, target) ?? 'You cannot remove this person', 403);
  }

  const summary = await removeUser(user, id);
  if (!summary) return fail('User not found', 404);

  return ok({ removed: summary });
}
