import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { addProgressUpdate, getTask, listProgressUpdates, submitForReview } from '@/lib/store';
import { canPostProgress, canSubmitForReview, canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  return ok({ updates: await listProgressUpdates(id) });
}

interface Body {
  percent?: number;
  doneSummary?: string;
  remaining?: string;
  blockers?: string;
  hoursSpent?: number | null;
  /** true = hand the task to a Team Lead for review rather than just logging progress. */
  submit?: boolean;
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);
  if (!canPostProgress(user, task)) {
    return fail('Only the developer working on this task can report progress', 403);
  }

  const body = await readJson<Body>(req);

  if (body.submit) {
    if (!canSubmitForReview(user, task)) {
      return fail(
        task.status === 'SUBMITTED'
          ? 'This is already waiting on a review'
          : task.status === 'DONE'
            ? 'This task is already approved'
            : 'Only the assigned developer can submit this for review',
        400
      );
    }
    if (!(body.doneSummary ?? '').trim()) {
      return fail('Say what you completed before submitting it for review');
    }
    return ok({ task: await submitForReview(user, id, body) }, 201);
  }

  if (!(body.doneSummary ?? '').trim() && !(body.remaining ?? '').trim()) {
    return fail('Add what you did or what is left before posting an update');
  }

  const update = await addProgressUpdate(user, id, 'update', body);
  return ok({ update, task: await getTask(id) }, 201);
}
