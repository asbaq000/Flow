import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { getUser, taskSheet } from '@/lib/store';
import { canViewTaskSheet } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const target = await getUser(id);
  if (!target || target.org_id !== user.org_id) return fail('User not found', 404);
  if (!canViewTaskSheet(user, target)) {
    return fail('Only a Team Lead can open someone else\u2019s task sheet', 403);
  }

  const sheet = await taskSheet(id);
  if (!sheet) return fail('User not found', 404);

  return ok({ sheet });
}
