import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { allUsers, getTask } from '@/lib/store';
import { canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Who can be @mentioned on this task.
 *
 * Only people already on it — the person who raised it, whoever it is assigned
 * to, anyone holding a split piece, and the Leads/CEO who oversee it. Mentioning
 * someone who cannot open the task would send them a notification to a 403, so
 * the list is derived from the same canView() rule the task itself uses.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  const members = (await allUsers()).filter((u) => canView(u, task));
  return ok({ members });
}
