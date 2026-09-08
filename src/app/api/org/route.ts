import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { getOrganization, renameOrganization, rotateInviteCode, rotateLeadInviteCode } from '@/lib/store';
import { isCeo } from '@/lib/permissions';

/**
 * The organisation the signed-in person belongs to, with whichever invite
 * codes are theirs to hand out: the CEO holds the one that admits Managers
 * and Team Leads, a Team Lead holds the one that only admits Developers.
 * Everyone else just sees the name.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const org = await getOrganization(user.org_id);
  if (!org) return fail('Organisation not found', 404);

  const { invite_code, lead_invite_code, ...rest } = org;
  if (isCeo(user)) return ok({ org: { ...rest, invite_code, lead_invite_code } });
  if (user.role === 'TEAM_LEAD') return ok({ org: { ...rest, lead_invite_code } });
  return ok({ org: rest });
}

interface Body {
  name?: string;
  /** true = mint a new organisation code, invalidating the old one. CEO only. */
  rotateInvite?: boolean;
  /** true = mint a new developer code. The CEO or any Team Lead. */
  rotateLeadInvite?: boolean;
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const body = await readJson<Body>(req);
  const ceo = isCeo(user);

  if (typeof body.name === 'string') {
    if (!ceo) return fail('Only the CEO can rename the organisation', 403);
    const name = body.name.trim();
    if (name.length < 2) return fail('Give the organisation a name');
    await renameOrganization(user.org_id, name.slice(0, 80));
  }
  if (body.rotateInvite) {
    if (!ceo) return fail('Only the CEO can change the organisation code', 403);
    await rotateInviteCode(user.org_id);
  }
  if (body.rotateLeadInvite) {
    // A Lead owns the code they hand to their own developers.
    if (!ceo && user.role !== 'TEAM_LEAD') return fail('Only a Team Lead or the CEO can change the developer code', 403);
    await rotateLeadInviteCode(user.org_id);
  }

  const org = await getOrganization(user.org_id);
  if (!org) return fail('Organisation not found', 404);
  const { invite_code, lead_invite_code, ...rest } = org;
  if (ceo) return ok({ org: { ...rest, invite_code, lead_invite_code } });
  return ok({ org: { ...rest, lead_invite_code } });
}
