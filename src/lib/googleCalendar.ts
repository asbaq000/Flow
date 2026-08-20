/**
 * Google Calendar, driven by one central account.
 *
 * Nobody using Flow ever connects a Google account. A single dedicated account
 * is authorised once by whoever runs the install, and its refresh token lives
 * in the environment — so every meeting is created by that one identity, with
 * our users added as attendees. Google then owns the invite email, the
 * reminder and the Meet link; we only keep what the app needs to show.
 *
 * Configure in .env.local (see .env.example):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
 *   GOOGLE_CALENDAR_ID (defaults to the account's own calendar)
 *
 * Deliberately no `googleapis` dependency: this is two HTTP calls, and the
 * official client is a large thing to ship into a serverless bundle for that.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN ?? '';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

export const googleCalendarEnabled = Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars';

/**
 * Raised for anything Google refuses. `reauth` marks the one failure an
 * operator has to act on personally — the rest are worth simply retrying.
 */
export class GoogleCalendarError extends Error {
  reauth: boolean;
  constructor(message: string, reauth = false) {
    super(message);
    this.name = 'GoogleCalendarError';
    this.reauth = reauth;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __flow_google_token__: { value: string; expiresAt: number } | undefined;
}

/**
 * Access tokens last an hour, so one is cached on the process and reused by
 * every request a warm instance serves. Refreshing on each call would add a
 * round trip to Google before the round trip that does the actual work.
 */
async function accessToken(): Promise<string> {
  const cached = global.__flow_google_token__;
  // A minute of slack, so a token cannot expire mid-flight.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !body.access_token) {
    /*
     * invalid_grant means the refresh token is gone for good — revoked, or
     * expired because the OAuth consent screen was left in "Testing", where
     * Google expires them after seven days. No amount of retrying fixes it;
     * someone has to authorise the account again.
     */
    const reauth = body.error === 'invalid_grant';
    throw new GoogleCalendarError(
      reauth
        ? 'The Google account needs to be re-authorised (its refresh token is no longer valid).'
        : `Google refused the token request: ${body.error_description ?? body.error ?? res.status}`,
      reauth
    );
  }

  global.__flow_google_token__ = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
}

interface GoogleEvent {
  id?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  error?: { message?: string };
}

export interface CreatedMeeting {
  eventId: string;
  joinUrl: string;
}

/**
 * Creates the calendar event and asks Google to mint a Meet link for it.
 * `sendUpdates=all` is what actually emails our attendees their invite.
 */
export async function createMeetEvent(input: {
  title: string;
  agenda: string;
  startsAt: number;
  durationMin: number;
  timeZone: string;
  attendeeEmails: string[];
}): Promise<CreatedMeeting> {
  const token = await accessToken();
  const endsAt = input.startsAt + input.durationMin * 60_000;

  /*
   * An RFC3339 instant in UTC plus the organiser's zone: the moment is exact
   * either way, and the zone tells Google how to render it in the invite.
   */
  const body = {
    summary: input.title,
    description: input.agenda,
    start: { dateTime: new Date(input.startsAt).toISOString(), timeZone: input.timeZone },
    end: { dateTime: new Date(endsAt).toISOString(), timeZone: input.timeZone },
    attendees: input.attendeeEmails.map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        // Google dedupes retries by this id, so it must be fresh per attempt.
        requestId: globalThis.crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  const res = await fetch(
    `${CALENDAR_URL}/${encodeURIComponent(CALENDAR_ID)}/events` +
      `?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const event = (await res.json().catch(() => ({}))) as GoogleEvent;

  if (!res.ok) {
    throw new GoogleCalendarError(
      `Google could not create the event: ${event.error?.message ?? res.status}`,
      res.status === 401
    );
  }

  const joinUrl =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;

  if (!event.id || !joinUrl) {
    // The event exists but has no Meet link, so treat it as a failure the
    // organiser can retry rather than handing them a meeting nobody can join.
    throw new GoogleCalendarError('Google created the event but returned no Meet link.');
  }

  return { eventId: event.id, joinUrl };
}

/** Cancels the event and lets Google tell the attendees. */
export async function cancelMeetEvent(eventId: string): Promise<void> {
  const token = await accessToken();

  const res = await fetch(
    `${CALENDAR_URL}/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}` +
      `?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );

  // Already gone is the outcome we wanted, not a problem.
  if (res.ok || res.status === 404 || res.status === 410) return;

  const body = (await res.json().catch(() => ({}))) as GoogleEvent;
  throw new GoogleCalendarError(
    `Google could not cancel the event: ${body.error?.message ?? res.status}`,
    res.status === 401
  );
}
