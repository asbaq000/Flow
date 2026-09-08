import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { clearConversation, isConversationMember } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Empties the conversation for the person asking — and only for them. What
 * was said stays with everyone else, the way a chat app clears a thread on
 * one phone without reaching into anyone else's.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  if (!(await isConversationMember(id, user.id))) return fail('You are not in this conversation', 403);

  await clearConversation(id, user.id);
  return ok({ ok: true });
}
