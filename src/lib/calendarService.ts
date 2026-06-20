import { graphRequest } from './graphClient';

const MAILBOX = process.env.CALENDAR_USER_EMAIL!;
const TZ = 'Asia/Singapore';

export interface BookingDetails {
  clientName: string;
  clientEmail: string;
  goal: string;
  challenges: string[];
  startIso: string;  // ISO 8601 e.g. "2026-07-10T10:00:00"
  endIso: string;
  zoomJoinUrl: string;
  zoomMeetingId: string;
  notes?: string;
}

export async function createOutlookEvent(booking: BookingDetails) {
  const subject = `AnyHealth Initial Consultation – ${booking.clientName}`;

  const bodyHtml = `
    <h2 style="color:#374187;font-family:sans-serif">New Client Consultation</h2>
    <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
      <tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600">Client</td><td style="padding:6px 0">${booking.clientName}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600">Email</td><td style="padding:6px 0"><a href="mailto:${booking.clientEmail}">${booking.clientEmail}</a></td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600">Goal</td><td style="padding:6px 0">${booking.goal}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600">Challenges</td><td style="padding:6px 0">${booking.challenges.join(', ')}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600">Zoom Link</td><td style="padding:6px 0"><a href="${booking.zoomJoinUrl}">${booking.zoomJoinUrl}</a></td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600">Meeting ID</td><td style="padding:6px 0">${booking.zoomMeetingId}</td></tr>
    </table>
    ${booking.notes ? `<p style="margin-top:16px;font-family:sans-serif"><strong>Notes:</strong> ${booking.notes}</p>` : ''}
  `;

  const event = {
    subject,
    body: { contentType: 'HTML', content: bodyHtml },
    start: { dateTime: booking.startIso, timeZone: TZ },
    end:   { dateTime: booking.endIso,   timeZone: TZ },
    location: {
      displayName: 'Zoom Video Call',
      locationUri: booking.zoomJoinUrl,
    },
    attendees: [
      {
        emailAddress: { address: booking.clientEmail, name: booking.clientName },
        type: 'required',
      },
    ],
    isReminderOn: true,
    reminderMinutesBeforeStart: 30,
    showAs: 'busy',
    categories: ['AnyHealth Booking'],
  };

  return graphRequest('POST', `/users/${MAILBOX}/calendar/events`, event);
}
