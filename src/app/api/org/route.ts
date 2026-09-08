import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { getOrganization, renameOrganization, rotateInviteCode } from '@/lib/store';
import { isCeo } from '@/lib/permissions';

/** The organisation the signed-in person belongs to. The CEO also sees the invite code. */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const org = await getOrganization(user.org_id);
  if (!org) return fail('Organisation not found', 404);

  const { invite_code, ...rest } = org;
  return ok({ org: isCeo(user) ? { ...rest, invite_code } : rest });
}

interface Body {
  name?: string;
  /** true = mint a new invite code, invalidating the old one. */
  rotateInvite?: boolean;
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);
  if (!isCeo(user)) return fail('Only the CEO can change the organisation', 403);

  const body = await readJson<Body>(req);

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (name.length < 2) return fail('Give the organisation a name');
    await renameOrganization(user.org_id, name.slice(0, 80));
  }
  if (body.rotateInvite) await rotateInviteCode(user.org_id);

  return ok({ org: await getOrganization(user.org_id) });
}
