import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { getConversation, isConversationMember, sendMessage } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  if (!(await isConversationMember(id, user.id))) return fail('You are not in this conversation', 403);

  const conversation = await getConversation(id, user.id);
  if (!conversation) return fail('Conversation not found', 404);
  // A finished task's group stays readable, but the discussion is over.
  if (conversation.closed_at) return fail('This group closed when the task was approved', 400);

  const body = await readJson<{ body?: string }>(req);
  const text = (body.body ?? '').trim();
  if (!text) return fail('Write something first');

  return ok({ message: await sendMessage(user, id, text) }, 201);
}
