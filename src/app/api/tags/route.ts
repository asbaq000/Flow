import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { allTags, upsertTag } from '@/lib/store';
import { TAG_COLORS } from '@/lib/types';

export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);
  return ok({ tags: await allTags(user.org_id) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { name = '', color = 'gray' } = await readJson<{ name?: string; color?: string }>(req);
  const clean = name.trim().slice(0, 32);
  if (!clean) return fail('Tag needs a name');

  const safeColor = (TAG_COLORS as readonly string[]).includes(color) ? color : 'gray';
  return ok({ tag: await upsertTag(user.org_id, clean, safeColor) }, 201);
}
