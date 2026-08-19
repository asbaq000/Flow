import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { approveSubmission, getTask, requestChanges } from '@/lib/store';
import { canApprove, canRequestChanges, canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

interface Body {
  decision?: 'approve' | 'request_changes';
  note?: string;
}

/**
 * The review gate. A developer submits; only a Team Lead, Manager or the CEO
 * decides whether that submission becomes DONE or goes back for another pass.
 */
export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  const { decision, note = '' } = await readJson<Body>(req);
  if (decision !== 'approve' && decision !== 'request_changes') {
    return fail('Say whether you are approving or requesting changes');
  }

  if (task.status !== 'SUBMITTED') {
    return fail('There is nothing waiting for review on this task', 400);
  }

  if (decision === 'approve') {
    if (!canApprove(user, task)) return fail('Only a Team Lead can approve work', 403);
    return ok({ task: await approveSubmission(user, id, note.trim()) });
  }

  if (!canRequestChanges(user, task)) return fail('Only a Team Lead can send work back', 403);
  if (!note.trim()) return fail('Tell the developer what needs to change');
  return ok({ task: await requestChanges(user, id, note.trim()) });
}
