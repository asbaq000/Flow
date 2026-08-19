import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { addLink, getTask } from '@/lib/store';
import { canEditContent, canView } from '@/lib/permissions';
import { normalizeUrl } from '@/lib/url';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);
  if (!canEditContent(user, task)) return fail('You cannot edit this task', 403);

  const { url = '', label = '' } = await readJson<{ url?: string; label?: string }>(req);
  const clean = normalizeUrl(url);
  if (!clean) return fail('Enter a valid http or https link');

  return ok({ link: await addLink(id, clean, label.trim()) }, 201);
}
