import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import {
  getConversation, hideConversation, isConversationMember, listMessages, markConversationRead,
} from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

/** The conversation plus its messages. Opening it counts as reading it. */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  if (!(await isConversationMember(id, user.id))) return fail('You are not in this conversation', 403);

  const conversation = await getConversation(id, user.id);
  if (!conversation) return fail('Conversation not found', 404);

  const messages = await listMessages(id, user.id);
  await markConversationRead(id, user.id);

  return ok({ conversation: { ...conversation, unread: 0 }, messages });
}

/**
 * "Delete chat" — for you. The room leaves your list and its history is
 * cleared for you; it comes back the moment somebody writes in it again.
 * Nobody else's copy is touched, and a task group cannot be left at all
 * while you are on the task.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  if (!(await isConversationMember(id, user.id))) return fail('You are not in this conversation', 403);

  await hideConversation(id, user.id);
  return ok({ ok: true });
}
