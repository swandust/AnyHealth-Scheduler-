import { NextResponse, type NextRequest } from 'next/server';
import { buildIcs } from '@/lib/ics';
import { FROM_EMAIL } from '@/lib/mailer';
import { addMinutesLocal } from '@/lib/time';
import { DURATION_MINUTES } from '@/lib/availability';

/**
 * "Add to calendar" link on the confirmation page.
 * Kept so the client can re-add the event if they lose the emailed invite.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  const name = q.get('name') ?? 'Client';
  const email = q.get('email') ?? '';
  const startLocal = q.get('start') ?? '';
  const meetUrl = q.get('meet') ?? q.get('zoom') ?? ''; // ?zoom= kept for old links
  const bookingRef = q.get('ref') ?? '';

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startLocal)) {
    return NextResponse.json({ error: 'Missing or malformed start time' }, { status: 400 });
  }

  const endLocal = q.get('end') ?? addMinutesLocal(startLocal, DURATION_MINUTES);

  const ics = buildIcs({
    uid: bookingRef
      ? `anyhealth-${bookingRef}@anyhealth.asia`
      : `anyhealth-${Date.now()}@anyhealth.asia`,
    summary: 'AnyHealth – Initial Consultation',
    description: [
      'Your AnyHealth consultation.',
      meetUrl ? `\nJoin on Google Meet: ${meetUrl}` : '',
      bookingRef ? `\nBooking ref: ${bookingRef}` : '',
    ].join(''),
    location: meetUrl || 'Google Meet',
    url: meetUrl || undefined,
    startLocal,
    endLocal,
    organizerEmail: FROM_EMAIL,
    organizerName: 'AnyHealth',
    attendeeEmail: email || undefined,
    attendeeName: name,
  });

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="anyhealth-appointment.ics"',
      'Cache-Control': 'no-store',
    },
  });
}
