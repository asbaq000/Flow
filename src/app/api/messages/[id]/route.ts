import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { deleteMessage, editMessage } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

/** Rewording your own message. The room shows it as edited. */
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const { body } = await readJson<{ body?: string }>(req);
  const text = (body ?? '').trim();
  if (!text) return fail('Write something first');

  const result = await editMessage(user, id, text);
  if (!result.ok) return fail(result.error, result.status);
  return ok({ message: result.message });
}

/** Taking a message back. The bubble stays as "deleted" so the thread still reads. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const result = await deleteMessage(user, id);
  if (!result.ok) return fail(result.error, result.status);
  return ok({ ok: true });
}
