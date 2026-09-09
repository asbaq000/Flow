import type { User } from './types';

/**
 * Times written by the server, in the clock of the person who will read them.
 *
 * Every host worth deploying to runs in UTC, so anything formatted here is
 * five hours out for somebody in Karachi and eight for somebody in Los
 * Angeles unless it is told otherwise. The browser knows the answer and sends
 * it once (see PATCH /api/me); this is where that gets used.
 *
 * The fallbacks are deliberate and in order: the person's own zone, then a
 * zone the operator set for the whole install, then UTC — which is at least
 * honest rather than accidentally somebody else's local time.
 */
function zoneFor(user: Pick<User, 'time_zone'> | null | undefined): string {
  return user?.time_zone || process.env.APP_TIMEZONE || 'UTC';
}

/** "11:33 GMT+5" — the offset included, because a bare time invites the wrong reading. */
export function timeForUser(user: Pick<User, 'time_zone'> | null | undefined, at: number): string {
  return format(at, zoneFor(user), { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

/** "9 Sep, 11:33 GMT+5" — for anything that could be about another day. */
export function dateTimeForUser(user: Pick<User, 'time_zone'> | null | undefined, at: number): string {
  return format(at, zoneFor(user), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function format(at: number, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone, hour12: false }).format(new Date(at));
  } catch {
    // A zone the runtime does not carry data for should not lose the time.
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC', hour12: false }).format(new Date(at));
  }
}
