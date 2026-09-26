import { getGoogleAccessToken, isGoogleConfigured } from './googleAuth';

/**
 * Google Calendar + Google Meet integration.
 *
 * Replaces the old Microsoft Graph (Outlook) + Zoom pair. One Google account
 * now does both jobs: the event lives in Google Calendar, and Google mints the
 * Meet link as part of creating that event — there is no second video API to
 * authenticate against.
 *
 * Auth lives in ./googleAuth — the same refresh token also sends the mail.
 * A refresh token is used rather than a service account because service
 * accounts need Google Workspace domain-wide delegation, which is not
 * available on a plain Google account.
 */

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export const TIMEZONE = process.env.BOOKING_TIMEZONE ?? 'Asia/Singapore';

function calendarId(): string {
  return encodeURIComponent(process.env.GOOGLE_CALENDAR_ID ?? 'primary');
}

export { getGoogleAccessToken, isGoogleConfigured };

async function googleRequest<T>(
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  path: string,
  body?: object
): Promise<T> {
  const token = await getGoogleAccessToken();

  const res = await fetch(`${CALENDAR_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      `Google Calendar error (${method} ${path}): ${err.error?.message ?? `HTTP ${res.status}`}`
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ─── Creating the event + Meet link ─────────────────────────────────────── */

export interface MeetEvent {
  eventId: string;
  meetUrl: string;
  htmlLink: string;
}

interface GoogleEventResponse {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    conferenceId?: string;
  };
}

export async function createMeetEvent(params: {
  bookingRef: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  role?: string;
  challenges?: string[];
  /** Local wall-clock time, "YYYY-MM-DDTHH:MM:SS", in {@link TIMEZONE}. */
  startLocal: string;
  endLocal: string;
  /** Let Google email the calendar invite as well as our own confirmation. */
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}): Promise<MeetEvent> {
  const description = [
    'AnyHealth initial consultation — booked through the online scheduler.',
    '',
    `Name:       ${params.clientName}`,
    `Email:      ${params.clientEmail}`,
    params.clientPhone ? `Phone:      ${params.clientPhone}` : null,
    params.role ? `Role:       ${params.role}` : null,
    params.challenges?.length ? `Challenges: ${params.challenges.join(', ')}` : null,
    '',
    `Booking ref: ${params.bookingRef}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Also invite the team inbox (contact@anyhealth.asia) so a calendar invite
  // lands there for every booking, independent of the Gmail account. Google
  // emails each attendee directly because sendUpdates is 'all'.
  const teamInvite = process.env.TEAM_INVITE_EMAIL ?? process.env.NOTIFY_EMAIL ?? process.env.FROM_EMAIL;
  const attendees: Array<{ email: string; displayName?: string }> = [
    { email: params.clientEmail, displayName: params.clientName },
  ];
  if (teamInvite && teamInvite.toLowerCase() !== params.clientEmail.toLowerCase()) {
    attendees.push({ email: teamInvite, displayName: 'AnyHealth' });
  }

  const body = {
    summary: `AnyHealth Consultation – ${params.clientName}`,
    description,
    start: { dateTime: params.startLocal, timeZone: TIMEZONE },
    end: { dateTime: params.endLocal, timeZone: TIMEZONE },
    attendees,
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
    // Asking Google for a Meet link as part of event creation is what replaces
    // the whole Zoom integration.
    conferenceData: {
      createRequest: {
        requestId: `anyhealth-${params.bookingRef}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    extendedProperties: {
      private: {
        anyhealthBookingRef: params.bookingRef,
        anyhealthSource: 'scheduler',
      },
    },
  };

  const sendUpdates = params.sendUpdates ?? 'all';
  // conferenceDataVersion=1 is REQUIRED, otherwise Google silently ignores
  // `conferenceData` and you get an event with no Meet link.
  const query = `?conferenceDataVersion=1&sendUpdates=${sendUpdates}`;

  const event = await googleRequest<GoogleEventResponse>(
    'POST',
    `/calendars/${calendarId()}/events${query}`,
    body
  );

  const meetUrl =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
    '';

  if (!meetUrl) {
    throw new Error(
      'Google created the event but returned no Meet link. Check that the ' +
        'Google account is allowed to create Meet conferences.'
    );
  }

  return {
    eventId: event.id,
    meetUrl,
    htmlLink: event.htmlLink ?? '',
  };
}

export async function deleteEvent(eventId: string): Promise<void> {
  await googleRequest<void>(
    'DELETE',
    `/calendars/${calendarId()}/events/${encodeURIComponent(eventId)}?sendUpdates=all`
  );
}

/* ─── Availability ───────────────────────────────────────────────────────── */

export interface BusyInterval {
  start: string; // UTC ISO
  end: string;   // UTC ISO
}

/**
 * Ask Google which parts of the window are already busy. Replaces the old
 * Graph `calendarView` call. freeBusy is used rather than listing events
 * because it respects the calendar's own "busy/free" setting and handles
 * recurring events without pagination.
 */
export async function getBusyIntervals(
  timeMinUtcIso: string,
  timeMaxUtcIso: string
): Promise<BusyInterval[]> {
  const id = process.env.GOOGLE_CALENDAR_ID ?? 'primary';

  const data = await googleRequest<{
    calendars?: Record<string, { busy?: BusyInterval[]; errors?: Array<{ reason: string }> }>;
  }>('POST', '/freeBusy', {
    timeMin: timeMinUtcIso,
    timeMax: timeMaxUtcIso,
    timeZone: TIMEZONE,
    items: [{ id }],
  });

  const entry = data.calendars?.[id];
  if (entry?.errors?.length) {
    throw new Error(
      `Google freeBusy refused calendar "${id}": ${entry.errors.map((e) => e.reason).join(', ')}`
    );
  }
  return entry?.busy ?? [];
}
