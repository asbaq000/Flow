import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { getTask, getUser, splitTask } from '@/lib/store';
import { canSplit, canView, isAssignableRole } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

interface Body {
  pieces?: { title: string; assigneeId: string | null; estimate?: number | null }[];
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);
  if (!canSplit(user, task)) {
    return fail(
      task.parent_id ? 'A subtask cannot be split again' : 'Only a Team Lead can split work',
      403
    );
  }

  const { pieces = [] } = await readJson<Body>(req);
  const valid = pieces.filter((p) => p && typeof p.title === 'string' && p.title.trim());
  if (valid.length < 2) return fail('A split needs at least two pieces');

  // Each piece is real work, so it obeys the same rule: Developers only.
  for (const piece of valid) {
    if (!piece.assigneeId) continue;
    const target = await getUser(piece.assigneeId);
    if (!target || target.org_id !== user.org_id) {
      return fail('One of the pieces names someone who is not in this workspace', 404);
    }
    if (!isAssignableRole(target.role)) {
      return fail(`Pieces can only go to Developers. ${target.name} is not one.`, 400);
    }
  }

  const updated = await splitTask(user, id, valid);
  return ok({ task: updated }, 201);
}
