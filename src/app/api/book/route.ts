import { NextResponse, type NextRequest } from 'next/server';
import { DURATION_MINUTES, findSlot } from '@/lib/availability';
import { createMeetEvent, isGoogleConfigured } from '@/lib/googleCalendar';
import {
  sendClientConfirmation,
  sendPersistenceFailureAlert,
  sendPractitionerNotification,
  type BookingEmailParams,
} from '@/lib/emailService';
import {
  SlotTakenError,
  insertBooking,
  logBookingEvent,
  recordWebsiteEvent,
  updateBooking,
} from '@/lib/supabase';
import { TIMEZONE, localToUtc } from '@/lib/time';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * visitor_id / session_id land in uuid columns. Anything that is not a uuid
 * is discarded rather than passed through — one malformed value from a stale
 * cookie would otherwise fail the whole insert and lose the booking.
 */
function asUuid(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

function asUtm(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^utm_[a-z]+$/.test(k) && typeof v === 'string' && v) {
      out[k] = v.slice(0, 200);
    }
  }
  return out;
}

function generateBookingRef(): string {
  return `AH-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const clientName = String(payload.clientName ?? '').trim();
  const clientEmail = String(payload.clientEmail ?? '').trim();
  const clientPhone = String(payload.clientPhone ?? '').trim();
  const role = String(payload.goal ?? payload.role ?? '').trim();
  const challenges = asStringArray(payload.challenges);
  const date = String(payload.date ?? '').trim();
  const time = String(payload.time ?? '').trim();

  // Website analytics identity — absent for anyone who deep-links straight to
  // /book, which is fine: booking_attribution falls back to matching on email.
  const visitorId = asUuid(payload.visitorId);
  const sessionId = asUuid(payload.sessionId);
  const sourcePath = String(payload.sourcePath ?? '').trim().slice(0, 500) || null;
  const referrer = String(payload.referrer ?? '').trim().slice(0, 1000) || null;
  const utm = asUtm(payload.utm);

  /* ── Validation ───────────────────────────────────────────────────────── */
  if (!clientName) return NextResponse.json({ error: 'Your name is required' }, { status: 400 });
  if (!clientEmail) return NextResponse.json({ error: 'Your email is required' }, { status: 400 });
  if (!EMAIL_RE.test(clientEmail))
    return NextResponse.json({ error: 'That email address does not look right' }, { status: 400 });
  if (!role) return NextResponse.json({ error: 'Please tell us your role' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return NextResponse.json({ error: 'Please pick a date and time' }, { status: 400 });

  /* ── Is the slot still bookable? ──────────────────────────────────────── */
  const slot = await findSlot(date, time);
  if (!slot) {
    return NextResponse.json(
      { error: 'That time is no longer available. Please choose another slot.' },
      { status: 409 }
    );
  }

  const bookingRef = generateBookingRef();
  const startUtc = localToUtc(slot.startIso, TIMEZONE);
  const endUtc = localToUtc(slot.endIso, TIMEZONE);

  /* ── 1. Persist FIRST, so the answers survive whatever happens next ───── */
  let bookingId: string | null = null;
  let persisted = false;
  let persistenceError: string | null = null;

  try {
    const row = await insertBooking({
      booking_ref: bookingRef,
      client_name: clientName,
      client_email: clientEmail,
      client_phone: clientPhone || null,
      role,
      challenges,
      answers: {
        role,
        challenges,
        name: clientName,
        email: clientEmail,
        phone: clientPhone,
        date,
        time,
        submittedAt: new Date().toISOString(),
        raw: payload,
      },
      slot_date: date,
      slot_time: time,
      start_local: slot.startIso,
      end_local: slot.endIso,
      start_utc: startUtc.toISOString(),
      end_utc: endUtc.toISOString(),
      timezone: TIMEZONE,
      duration_minutes: DURATION_MINUTES,
      source: 'web',
      user_agent: req.headers.get('user-agent'),
      visitor_id: visitorId,
      session_id: sessionId,
      source_path: sourcePath,
      referrer,
      utm,
    });

    if (row) {
      bookingId = row.id;
      persisted = true;
    } else {
      persistenceError = 'Supabase is not configured or the insert was rejected';
    }
  } catch (err) {
    if (err instanceof SlotTakenError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    persistenceError = err instanceof Error ? err.message : String(err);
  }

  await logBookingEvent({
    bookingId,
    bookingRef,
    step: 'received',
    ok: persisted,
    message: persisted ? 'Booking saved, calling Google next' : (persistenceError ?? undefined),
  });

  if (!persisted) {
    console.error(
      `[booking ${bookingRef}] NOT SAVED to Supabase: ${persistenceError}. ` +
        `Payload: ${JSON.stringify(payload)}`
    );
  }

  /* ── 2. Google Calendar event + Meet link ─────────────────────────────── */
  if (!isGoogleConfigured()) {
    const reason = 'Google credentials are not configured';
    await updateBooking(bookingId, {
      status: 'failed',
      calendar_status: 'skipped',
      calendar_error: reason,
    });
    await logBookingEvent({ bookingId, bookingRef, step: 'google_calendar', ok: false, message: reason });

    // Even a mis-configured deploy must not swallow the answers.
    await sendPersistenceFailureAlert({
      bookingRef,
      clientName,
      clientEmail,
      clientPhone,
      role,
      challenges,
      startLocal: slot.startIso,
      endLocal: slot.endIso,
      meetUrl: '',
      reason,
      rawPayload: { ...payload, bookingRef, persisted },
    }).catch(() => undefined);

    return NextResponse.json(
      {
        error:
          'Online booking is temporarily unavailable. Please email contact@anyhealth.asia and we will confirm by hand.',
        bookingRef,
      },
      { status: 503 }
    );
  }

  let meetUrl: string;
  let googleEventId: string;
  let googleHtmlLink: string;

  try {
    const event = await createMeetEvent({
      bookingRef,
      clientName,
      clientEmail,
      clientPhone,
      role,
      challenges,
      startLocal: slot.startIso,
      endLocal: slot.endIso,
      sendUpdates: 'all',
    });

    meetUrl = event.meetUrl;
    googleEventId = event.eventId;
    googleHtmlLink = event.htmlLink;

    await updateBooking(bookingId, {
      meet_url: meetUrl,
      google_event_id: googleEventId,
      google_html_link: googleHtmlLink,
      calendar_status: 'ok',
      status: 'confirmed',
    });
    await logBookingEvent({
      bookingId,
      bookingRef,
      step: 'google_calendar',
      ok: true,
      message: 'Event created with Meet link',
      detail: { eventId: googleEventId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[booking ${bookingRef}] Google Calendar failed:`, message);

    await updateBooking(bookingId, {
      status: 'failed',
      calendar_status: 'failed',
      calendar_error: message,
    });
    await logBookingEvent({ bookingId, bookingRef, step: 'google_calendar', ok: false, message });

    // The row is safe in Supabase; alert a human so the booking can be rescued.
    await sendPersistenceFailureAlert({
      bookingRef,
      clientName,
      clientEmail,
      clientPhone,
      role,
      challenges,
      startLocal: slot.startIso,
      endLocal: slot.endIso,
      meetUrl: '',
      reason: `Google Calendar rejected the event: ${message}`,
      rawPayload: { ...payload, bookingRef, persisted },
    }).catch(() => undefined);

    return NextResponse.json(
      {
        error:
          'We could not create the meeting link just now. Your details are saved and we will email you the link shortly.',
        bookingRef,
      },
      { status: 502 }
    );
  }

  /* ── 3. Confirmation emails (never fatal — the meeting already exists) ── */
  const emailParams: BookingEmailParams = {
    bookingRef,
    clientName,
    clientEmail,
    clientPhone,
    role,
    challenges,
    startLocal: slot.startIso,
    endLocal: slot.endIso,
    meetUrl,
    durationMinutes: DURATION_MINUTES,
  };

  const [clientMail, practitionerMail] = await Promise.all([
    sendClientConfirmation(emailParams).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    })),
    sendPractitionerNotification(emailParams).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    })),
  ]);

  await updateBooking(bookingId, {
    client_email_status: clientMail.ok ? 'sent' : 'failed',
    practitioner_email_status: practitionerMail.ok ? 'sent' : 'failed',
    email_error: [clientMail.error, practitionerMail.error].filter(Boolean).join(' | ') || null,
  });

  await Promise.all([
    logBookingEvent({
      bookingId,
      bookingRef,
      step: 'email_client',
      ok: clientMail.ok,
      message: clientMail.ok ? 'Confirmation sent' : clientMail.error,
    }),
    logBookingEvent({
      bookingId,
      bookingRef,
      step: 'email_practitioner',
      ok: practitionerMail.ok,
      message: practitionerMail.ok ? 'Notification sent' : practitionerMail.error,
    }),
  ]);

  if (!clientMail.ok) {
    console.error(`[booking ${bookingRef}] client email failed: ${clientMail.error}`);
  }
  if (!practitionerMail.ok) {
    console.error(`[booking ${bookingRef}] practitioner email failed: ${practitionerMail.error}`);
  }

  // Put the booking into the website's own event stream so the funnel reads
  // end to end in one table. Best-effort by design.
  await recordWebsiteEvent({
    visitorId,
    sessionId,
    eventName: 'booking_completed',
    path: '/book',
    data: {
      booking_ref: bookingRef,
      role,
      challenges,
      slot_date: date,
      slot_time: time,
      matched_visitor: Boolean(visitorId),
    },
  });

  // Mail is best-effort: Google has already emailed the calendar invite, and
  // the confirmation page shows the Meet link, so the client is never stranded.
  return NextResponse.json({
    success: true,
    bookingRef,
    bookingId,
    meetUrl,
    startIso: slot.startIso,
    endIso: slot.endIso,
    persisted,
    emailSent: clientMail.ok,
  });
}
