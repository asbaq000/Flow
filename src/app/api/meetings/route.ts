import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { createMeeting, listMeetings } from '@/lib/store';
import { canScheduleMeeting, isLead } from '@/lib/permissions';
import { MEETING_DURATIONS } from '@/lib/types';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const scope = new URL(req.url).searchParams.get('scope');

  return ok({
    meetings: await listMeetings({
      // Leads run the schedule, so they see all of it. Everyone else sees
      // only the calls they are actually in.
      forUserId: isLead(user) ? null : user.id,
      scope: scope === 'past' ? 'past' : 'upcoming',
    }),
  });
}

interface Body {
  title?: string;
  agenda?: string;
  startsAt?: number;
  durationMin?: number;
  timeZone?: string;
  participantIds?: string[];
  taskId?: string | null;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);
  if (!canScheduleMeeting(user)) {
    return fail('Only a Team Lead or the CEO can schedule meetings', 403);
  }

  const body = await readJson<Body>(req);
  const title = (body.title ?? '').trim();
  const startsAt = Number(body.startsAt);
  const durationMin = Number(body.durationMin);
  const participantIds = Array.isArray(body.participantIds) ? body.participantIds : [];

  if (!title) return fail('Give the meeting a title');
  if (!Number.isFinite(startsAt) || startsAt <= 0) return fail('Pick when the meeting starts');
  if (!MEETING_DURATIONS.includes(durationMin as (typeof MEETING_DURATIONS)[number])) {
    return fail('Pick how long the meeting runs');
  }
  // The organiser joins automatically, so one other person is a real meeting.
  if (!participantIds.length) return fail('Invite at least one other person');

  const meeting = await createMeeting(user, {
    title,
    agenda: body.agenda ?? '',
    startsAt,
    durationMin,
    // Falling back to UTC keeps the instant correct even if the browser
    // sent nothing; only the label in the invite would differ.
    timeZone: (body.timeZone ?? '').trim() || 'UTC',
    participantIds,
    taskId: body.taskId ?? null,
  });

  return ok({ meeting }, 201);
}
