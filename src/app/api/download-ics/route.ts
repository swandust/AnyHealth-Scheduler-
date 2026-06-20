import { NextRequest, NextResponse } from 'next/server';

function toUtcStamp(localIso: string): string {
  const [datePart, timePart] = localIso.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi]    = timePart.split(':').map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d, h - 8, mi));
  return utc.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name      = searchParams.get('name') ?? 'Client';
  const email     = searchParams.get('email') ?? '';
  const startIso  = searchParams.get('start') ?? '';
  const endIso    = searchParams.get('end') ?? '';
  const zoomUrl   = searchParams.get('zoom') ?? '';
  const zoomId    = searchParams.get('meetingId') ?? '';
  const zoomPwd   = searchParams.get('password') ?? '';
  const uid       = searchParams.get('uid') ?? `anyhealth-${Date.now()}@anyhealth.asia`;

  if (!startIso || !endIso) {
    return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
  }

  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AnyHealth//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toUtcStamp(startIso)}`,
    `DTEND:${toUtcStamp(endIso)}`,
    'SUMMARY:AnyHealth – Initial Consultation',
    `DESCRIPTION:Join Zoom: ${zoomUrl}\\nMeeting ID: ${zoomId}\\nPasscode: ${zoomPwd}`,
    `LOCATION:${zoomUrl}`,
    `ORGANIZER;CN=AnyHealth:mailto:contact@anyhealth.asia`,
    email ? `ATTENDEE;CN=${name};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${email}` : '',
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:AnyHealth appointment in 30 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="anyhealth-appointment.ics"',
    },
  });
}
