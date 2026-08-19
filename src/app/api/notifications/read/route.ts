import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { markNotifications } from '@/lib/store';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { ids } = await readJson<{ ids?: string[] | 'all' }>(req);
  await markNotifications(user.id, ids ?? 'all');
  return ok({ ok: true });
}
