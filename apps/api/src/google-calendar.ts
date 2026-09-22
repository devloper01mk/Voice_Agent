/**
 * Optional Google Calendar sync. When credentials are missing, leads stay
 * calendarSyncStatus = "skipped" and the in-app month calendar still works.
 */

export interface CalendarEventInput {
  summary: string;
  description: string;
  location?: string;
  start: Date;
  end: Date;
  attendeeEmail?: string;
  timezone?: string;
  extendedPrivate?: Record<string, string>;
}

function calendarConfigured(): boolean {
  if (process.env.GOOGLE_CALENDAR_ENABLED === 'false') return false;
  const hasOauth =
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET) &&
    Boolean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  return hasOauth;
}

async function getAccessToken(): Promise<string | null> {
  if (!calendarConfigured()) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    console.error('Google OAuth token refresh failed', await res.text());
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID?.trim() || 'primary';
}

export async function createGoogleCalendarEvent(
  input: CalendarEventInput,
): Promise<{ ok: true; eventId: string } | { ok: false; status: 'skipped' | 'failed'; error?: string }> {
  if (!calendarConfigured()) {
    return { ok: false, status: 'skipped' };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, status: 'failed', error: 'No access token' };

  const tz = input.timezone ?? 'Asia/Kolkata';
  const body = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: input.start.toISOString(), timeZone: tz },
    end: { dateTime: input.end.toISOString(), timeZone: tz },
    attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
    extendedProperties: input.extendedPrivate
      ? { private: input.extendedPrivate }
      : undefined,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
      ],
    },
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId())}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('Google Calendar create failed', errText);
    return { ok: false, status: 'failed', error: errText.slice(0, 200) };
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) return { ok: false, status: 'failed', error: 'No event id' };
  return { ok: true, eventId: data.id };
}

export async function updateGoogleCalendarEvent(
  eventId: string,
  input: CalendarEventInput,
): Promise<{ ok: true } | { ok: false; status: 'skipped' | 'failed' }> {
  if (!calendarConfigured()) return { ok: false, status: 'skipped' };
  const token = await getAccessToken();
  if (!token) return { ok: false, status: 'failed' };

  const tz = input.timezone ?? 'Asia/Kolkata';
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: { dateTime: input.start.toISOString(), timeZone: tz },
        end: { dateTime: input.end.toISOString(), timeZone: tz },
      }),
    },
  );
  if (!res.ok) {
    console.error('Google Calendar update failed', await res.text());
    return { ok: false, status: 'failed' };
  }
  return { ok: true };
}

export async function deleteGoogleCalendarEvent(
  eventId: string,
): Promise<{ ok: true } | { ok: false; status: 'skipped' | 'failed' }> {
  if (!calendarConfigured()) return { ok: false, status: 'skipped' };
  const token = await getAccessToken();
  if (!token) return { ok: false, status: 'failed' };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    console.error('Google Calendar delete failed', await res.text());
    return { ok: false, status: 'failed' };
  }
  return { ok: true };
}

export function isGoogleCalendarConfigured(): boolean {
  return calendarConfigured();
}
