import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { getUser, listConversations, openDirectConversation } from '@/lib/store';

export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);
  return ok({ conversations: await listConversations(user.id) });
}

/** Opens (or finds) a one-to-one conversation with somebody. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const body = await readJson<{ userId?: string }>(req);
  if (!body.userId) return fail('Say who');
  if (body.userId === user.id) return fail('That is you');
  if (!(await getUser(body.userId))) return fail('Person not found', 404);

  return ok({ conversation: await openDirectConversation(user, body.userId) }, 201);
}
