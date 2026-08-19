import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { deleteComment, getComment, setCommentResolved } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const comment = await getComment(id);
  if (!comment) return fail('Comment not found', 404);

  const { resolved } = await readJson<{ resolved?: boolean }>(req);
  if (resolved === undefined) return fail('Nothing to update');

  await setCommentResolved(id, resolved);
  return ok({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const comment = await getComment(id);
  if (!comment) return fail('Comment not found', 404);

  // Authors delete their own words; admins can clean up anything.
  if (comment.author_id !== user.id && user.role !== 'CEO') {
    return fail('You can only delete your own comments', 403);
  }

  await deleteComment(id);
  return ok({ ok: true });
}
