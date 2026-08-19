import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { getTask, listActivity } from '@/lib/store';
import { canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  return ok({ activity: await listActivity(id) });
}
