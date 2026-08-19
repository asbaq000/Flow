import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { addComment, getTask, listComments } from '@/lib/store';
import { canComment, canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  return ok({ comments: await listComments(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canComment(user, task)) return fail('You do not have access to this task', 403);

  const { body = '' } = await readJson<{ body?: string }>(req);
  if (!body.trim()) return fail('Comment cannot be empty');

  return ok({ comment: await addComment(user, id, body.trim()) }, 201);
}
