import { graphRequest } from './graphClient';

const FROM_EMAIL      = process.env.FROM_EMAIL ?? 'contact@anyhealth.asia';
const NOTIFY_EMAIL    = process.env.NOTIFY_EMAIL ?? 'contact@anyhealth.asia';
const APP_URL         = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

function formatDateTime(isoLocal: string): string {
  // isoLocal is "YYYY-MM-DDTHH:MM:SS" in Asia/Singapore time
  const [datePart, timePart] = isoLocal.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'UTC',
  });

  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  const timeStr = `${h12}:${String(minute).padStart(2, '0')} ${ampm} (SGT / MYT)`;

  return `${dateStr} at ${timeStr}`;
}

function generateIcs(params: {
  uid: string;
  summary: string;
  description: string;
  location: string;
  startIso: string;   // "YYYY-MM-DDTHH:MM:SS" local SG time
  endIso: string;
  organizerEmail: string;
  clientEmail: string;
  clientName: string;
}): string {
  // Convert local "YYYY-MM-DDTHH:MM:SS" to UTC stamp (SG = UTC+8)
  function toUtcStamp(localIso: string): string {
    const [datePart, timePart] = localIso.split('T');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi] = timePart.split(':').map(Number);
    const utc = new Date(Date.UTC(y, mo - 1, d, h - 8, mi)); // subtract UTC+8
    return utc.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AnyHealth//Booking System//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toUtcStamp(params.startIso)}`,
    `DTEND:${toUtcStamp(params.endIso)}`,
    `SUMMARY:${params.summary}`,
    `DESCRIPTION:${params.description.replace(/\n/g, '\\n')}`,
    `LOCATION:${params.location}`,
    `ORGANIZER;CN=AnyHealth:mailto:${params.organizerEmail}`,
    `ATTENDEE;CN=${params.clientName};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${params.clientEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Upcoming AnyHealth Appointment',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

async function sendEmail(payload: {
  to: string[];
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; type: string }>;
}) {
  const message: any = {
    subject: payload.subject,
    body: {
      contentType: 'HTML',
      content: payload.html,
    },
    toRecipients: payload.to.map((email) => ({
      emailAddress: { address: email },
    })),
  };

  if (payload.attachments?.length) {
    message.attachments = payload.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.type,
      contentBytes: a.content,
    }));
  }

  await graphRequest('POST', `/users/${FROM_EMAIL}/sendMail`, {
    message,
    saveToSentItems: true,
  });
}

export interface EmailBookingParams {
  bookingId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  goal: string;
  challenges: string[];
  startIso: string;
  endIso: string;
  zoomJoinUrl: string;
  zoomMeetingId: string | number;
  zoomPassword: string;
}

export async function sendClientConfirmation(p: EmailBookingParams) {
  const dateTimeStr = formatDateTime(p.startIso);
  const icsContent  = generateIcs({
    uid: `anyhealth-${p.bookingId}@anyhealth.asia`,
    summary: 'AnyHealth – Initial Consultation',
    description: `Your AnyHealth consultation is confirmed.\n\nJoin Zoom: ${p.zoomJoinUrl}\nMeeting ID: ${p.zoomMeetingId}\nPasscode: ${p.zoomPassword}`,
    location: p.zoomJoinUrl,
    startIso: p.startIso,
    endIso: p.endIso,
    organizerEmail: FROM_EMAIL,
    clientEmail: p.clientEmail,
    clientName: p.clientName,
  });

  const icsBase64 = Buffer.from(icsContent).toString('base64');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f9fc;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;padding:0 16px">
    <!-- Header -->
    <div style="text-align:center;padding:32px 0 24px">
      <div style="font-size:28px;font-weight:800;color:#374187;letter-spacing:-0.5px">AnyHealth</div>
    </div>
    <!-- Card -->
    <div style="background:white;border-radius:24px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
      <div style="text-align:center;margin-bottom:32px">
        <div style="width:64px;height:64px;background:linear-gradient(135deg,#e8f4ff,#dce8ff);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <span style="font-size:32px">✅</span>
        </div>
        <h1 style="font-size:24px;font-weight:700;color:#191c1e;margin:0 0 8px">You're booked, ${p.clientName}!</h1>
        <p style="font-size:16px;color:#454650;margin:0">Your initial consultation is confirmed.</p>
      </div>
      <!-- Appointment details -->
      <div style="background:#f2f3f6;border-radius:16px;padding:24px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <span style="font-size:20px">📅</span>
          <div>
            <div style="font-size:12px;font-weight:600;color:#767682;text-transform:uppercase;letter-spacing:0.08em;font-family:'Courier New',monospace">Date & Time</div>
            <div style="font-size:16px;font-weight:600;color:#191c1e;margin-top:2px">${dateTimeStr}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <span style="font-size:20px">⏱️</span>
          <div>
            <div style="font-size:12px;font-weight:600;color:#767682;text-transform:uppercase;letter-spacing:0.08em;font-family:'Courier New',monospace">Duration</div>
            <div style="font-size:16px;font-weight:600;color:#191c1e;margin-top:2px">30 minutes</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:20px">💻</span>
          <div>
            <div style="font-size:12px;font-weight:600;color:#767682;text-transform:uppercase;letter-spacing:0.08em;font-family:'Courier New',monospace">Format</div>
            <div style="font-size:16px;font-weight:600;color:#191c1e;margin-top:2px">Online via Zoom</div>
          </div>
        </div>
      </div>
      <!-- Zoom join button -->
      <div style="text-align:center;margin-bottom:24px">
        <a href="${p.zoomJoinUrl}" style="display:inline-block;background:#0b5cad;color:white;font-weight:700;font-size:16px;padding:16px 32px;border-radius:9999px;text-decoration:none;letter-spacing:-0.2px">
          🎥 Join Zoom Meeting
        </a>
        <div style="margin-top:12px;font-size:13px;color:#767682">
          Meeting ID: <strong>${p.zoomMeetingId}</strong> &nbsp;·&nbsp; Passcode: <strong>${p.zoomPassword}</strong>
        </div>
      </div>
      <hr style="border:none;border-top:1px solid #e7e8eb;margin:24px 0">
      <!-- What to expect -->
      <div style="margin-bottom:24px">
        <h3 style="font-size:16px;font-weight:700;color:#191c1e;margin:0 0 12px">What to expect:</h3>
        <ul style="margin:0;padding-left:20px;color:#454650;font-size:15px;line-height:1.7">
          <li>A friendly 30-minute demo call to understand your goals.</li>
          <li>Find out how we can better support your patient outcomes.</li>
          <li>Discuss plans and product lines for your company.</li>
        </ul>
      </div>
      <div style="background:#fff8f0;border:1px solid #ffd6a5;border-radius:12px;padding:16px;margin-bottom:24px">
        <p style="margin:0;font-size:14px;color:#6b3d00">
          <strong>📎 Calendar invite attached</strong> — Open the attached .ics file to add this appointment to your calendar (works with Outlook, Google Calendar & Apple Calendar).
        </p>
      </div>
      <p style="font-size:14px;color:#767682;text-align:center;margin:0">
        Questions? Reply to this email or contact us at <a href="mailto:${FROM_EMAIL}" style="color:#374187">${FROM_EMAIL}</a>
      </p>
    </div>
    <div style="text-align:center;padding:24px 0;font-size:13px;color:#a0a0a8">
      © ${new Date().getFullYear()} AnyHealth · <a href="${APP_URL}" style="color:#374187">anyhealth.asia</a>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: [p.clientEmail],
    subject: `✅ Confirmed: Your AnyHealth Consultation on ${dateTimeStr.split(' at ')[0]}`,
    html,
    attachments: [
      { filename: 'anyhealth-appointment.ics', content: icsBase64, type: 'text/calendar;method=REQUEST' },
    ],
  });
}

export async function sendPractitionerNotification(p: EmailBookingParams) {
  const dateTimeStr = formatDateTime(p.startIso);
  
  const icsContent  = generateIcs({
    uid: `anyhealth-${p.bookingId}@anyhealth.asia`,
    summary: `AnyHealth Initial Consultation – ${p.clientName}`,
    description: `New client consultation.\n\nJoin Zoom: ${p.zoomJoinUrl}\nMeeting ID: ${p.zoomMeetingId}\nPasscode: ${p.zoomPassword}`,
    location: p.zoomJoinUrl,
    startIso: p.startIso,
    endIso: p.endIso,
    organizerEmail: p.clientEmail,
    clientEmail: NOTIFY_EMAIL,
    clientName: 'AnyHealth Scheduler',
  });

  const icsBase64 = Buffer.from(icsContent).toString('base64');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8f9fc;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;padding:0 16px">
    <div style="background:white;border-radius:24px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
      <h1 style="font-size:22px;font-weight:700;color:#374187;margin:0 0 8px">🗓️ New Booking — AnyHealth</h1>
      <p style="font-size:15px;color:#454650;margin:0 0 24px">A new consultation has been booked via the AnyHealth scheduler.</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        <tr style="border-bottom:1px solid #e7e8eb">
          <td style="padding:12px 0;font-weight:600;color:#767682;width:140px">Client Name</td>
          <td style="padding:12px 0;color:#191c1e">${p.clientName}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e8eb">
          <td style="padding:12px 0;font-weight:600;color:#767682">Email</td>
          <td style="padding:12px 0;color:#191c1e"><a href="mailto:${p.clientEmail}" style="color:#374187">${p.clientEmail}</a></td>
        </tr>
        <tr style="border-bottom:1px solid #e7e8eb">
          <td style="padding:12px 0;font-weight:600;color:#767682">Phone</td>
          <td style="padding:12px 0;color:#191c1e">${p.clientPhone}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e8eb">
          <td style="padding:12px 0;font-weight:600;color:#767682">Date & Time</td>
          <td style="padding:12px 0;color:#191c1e"><strong>${dateTimeStr}</strong></td>
        </tr>
        <tr style="border-bottom:1px solid #e7e8eb">
          <td style="padding:12px 0;font-weight:600;color:#767682">Goal</td>
          <td style="padding:12px 0;color:#191c1e">${p.goal}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e8eb">
          <td style="padding:12px 0;font-weight:600;color:#767682">Challenges</td>
          <td style="padding:12px 0;color:#191c1e">${p.challenges.join(', ')}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e8eb">
          <td style="padding:12px 0;font-weight:600;color:#767682">Booking ID</td>
          <td style="padding:12px 0;color:#767682;font-family:'Courier New',monospace;font-size:13px">${p.bookingId}</td>
        </tr>
      </table>
      <div style="margin-top:24px;text-align:center">
        <a href="${p.zoomJoinUrl}" style="display:inline-block;background:#0b5cad;color:white;font-weight:700;font-size:15px;padding:14px 28px;border-radius:9999px;text-decoration:none">
          🎥 Join as Host
        </a>
      </div>
      <div style="background:#fff8f0;border:1px solid #ffd6a5;border-radius:12px;padding:16px;margin-top:24px">
        <p style="margin:0;font-size:14px;color:#6b3d00">
          <strong>📎 Calendar invite attached</strong> — Open the attached .ics file to add this appointment to your calendar.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: [NOTIFY_EMAIL],
    subject: `📋 New Booking: ${p.clientName} — ${dateTimeStr.split(' at ')[0]}`,
    html,
    attachments: [
      { filename: 'anyhealth-appointment.ics', content: icsBase64, type: 'text/calendar;method=REQUEST' },
    ],
  });
}
