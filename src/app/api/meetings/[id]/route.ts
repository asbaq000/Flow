import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import {
  cancelMeeting, getMeeting, retryMeetingSync, setMeetingAttendance, setMeetingMinutes,
} from '@/lib/store';
import { canCancelMeeting, isLead } from '@/lib/permissions';
import type { MeetingFull, User } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/** Leads see every meeting; everyone else only the ones they are in. */
function canSee(user: User, meeting: MeetingFull): boolean {
  return (
    isLead(user) ||
    meeting.organizer_id === user.id ||
    meeting.participants.some((p) => p.id === user.id)
  );
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const meeting = await getMeeting(id);
  if (!meeting) return fail('Meeting not found', 404);
  if (!canSee(user, meeting)) return fail('You are not on this meeting', 403);

  return ok({ meeting });
}

interface Body {
  action?: 'retry' | 'minutes' | 'attendance';
  minutes?: string;
  userId?: string;
  /** true joined, false did not, null clears back to unrecorded. */
  attended?: boolean | null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const meeting = await getMeeting(id);
  if (!meeting) return fail('Meeting not found', 404);
  if (!canCancelMeeting(user, meeting)) {
    return fail('Only the organiser or a Team Lead can change this meeting', 403);
  }

  const body = await readJson<Body>(req);

  if (body.action === 'minutes') {
    if (typeof body.minutes !== 'string') return fail('Write the minutes first');
    const updated = await setMeetingMinutes(user, id, body.minutes);
    if (!updated) return fail('Meeting not found', 404);
    return ok({ meeting: updated });
  }

  if (body.action === 'attendance') {
    if (!body.userId) return fail('Say who');
    const attended = body.attended === null || body.attended === undefined ? null : Boolean(body.attended);
    const updated = await setMeetingAttendance(user, id, body.userId, attended);
    if (!updated) return fail('That person is not on this meeting', 404);
    return ok({ meeting: updated });
  }

  if (body.action !== 'retry') return fail('Unknown action');
  if (meeting.status === 'cancelled') return fail('This meeting was cancelled');

  const updated = await retryMeetingSync(user, id);
  if (!updated) return fail('Meeting not found', 404);

  return ok({ meeting: updated });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const meeting = await getMeeting(id);
  if (!meeting) return fail('Meeting not found', 404);
  if (!canCancelMeeting(user, meeting)) {
    return fail('Only the organiser or a Team Lead can cancel this meeting', 403);
  }

  return ok({ meeting: await cancelMeeting(user, id) });
}
