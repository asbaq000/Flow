import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { taskSheet } from '@/lib/store';
import { canViewTaskSheet } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  if (!canViewTaskSheet(user, id)) {
    return fail('Only a Team Lead can open someone else\u2019s task sheet', 403);
  }

  const sheet = await taskSheet(id);
  if (!sheet) return fail('User not found', 404);

  return ok({ sheet });
}
