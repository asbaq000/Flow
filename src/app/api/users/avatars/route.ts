import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { usersWithAvatars } from '@/lib/store';

/**
 * Which people have a picture, and which version of it. One small answer, so
 * the board knows to draw initials for everyone else instead of requesting
 * thirty pictures that do not exist and flashing a broken-image glyph for
 * each — and knows, on every load, whether the copy it has is still current.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const avatars = await usersWithAvatars(user.org_id);
  return ok({ avatars, ids: avatars.map((a) => a.id) });
}
