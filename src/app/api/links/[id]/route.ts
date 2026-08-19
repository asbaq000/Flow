import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { getLink, getTask, removeLink } from '@/lib/store';
import { canEditContent } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const link = await getLink(id);
  if (!link) return fail('Link not found', 404);

  const task = await getTask(link.task_id);
  if (!task || !canEditContent(user, task)) return fail('You cannot edit this task', 403);

  await removeLink(id);
  return ok({ ok: true });
}
