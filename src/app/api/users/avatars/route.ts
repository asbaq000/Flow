import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { usersWithAvatars } from '@/lib/store';

/**
 * Which people have a picture. One small answer, fetched once, so the board
 * knows to draw initials for everyone else instead of requesting thirty
 * pictures that do not exist and flashing a broken-image glyph for each.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);
  return ok({ ids: [...(await usersWithAvatars(user.org_id))] });
}
