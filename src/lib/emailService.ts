import { buildIcs } from './ics';
import {
  FROM_EMAIL,
  NOTIFY_EMAIL,
  sendMail,
  type MailResult,
} from './mailer';
import { TIMEZONE, formatDateOnly, formatForHumans } from './time';

const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

/* Brand tokens, kept in step with src/app/globals.css */
const GREEN = '#006c4e';
const GREEN_DARK = '#004732';
const INK = '#171d1a';
const MUTED = '#3d4a43';
const LINE = '#bccac1';
const CANVAS = '#f5fbf5';

/** Everything in these templates is user-supplied, so nothing goes in raw. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BookingEmailParams {
  bookingRef: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  role?: string;
  challenges?: string[];
  /** Local wall-clock, "YYYY-MM-DDTHH:MM:SS". */
  startLocal: string;
  endLocal: string;
  meetUrl: string;
  durationMinutes?: number;
}

function icsFor(p: BookingEmailParams, forPractitioner: boolean): string {
  const lines = [
    forPractitioner
      ? 'New client consultation booked through the AnyHealth scheduler.'
      : 'Your AnyHealth consultation is confirmed.',
    '',
    `Join on Google Meet: ${p.meetUrl}`,
    '',
    `Name: ${p.clientName}`,
    `Email: ${p.clientEmail}`,
    p.clientPhone ? `Phone: ${p.clientPhone}` : '',
    p.role ? `Role: ${p.role}` : '',
    p.challenges?.length ? `Challenges: ${p.challenges.join('; ')}` : '',
    '',
    `Booking ref: ${p.bookingRef}`,
  ].filter(Boolean);

  return buildIcs({
    uid: `anyhealth-${p.bookingRef}@anyhealth.asia`,
    summary: forPractitioner
      ? `AnyHealth Consultation – ${p.clientName}`
      : 'AnyHealth – Initial Consultation',
    description: lines.join('\n'),
    location: p.meetUrl,
    url: p.meetUrl,
    startLocal: p.startLocal,
    endLocal: p.endLocal,
    organizerEmail: FROM_EMAIL,
    organizerName: 'AnyHealth',
    attendeeEmail: forPractitioner ? NOTIFY_EMAIL : p.clientEmail,
    attendeeName: forPractitioner ? 'AnyHealth' : p.clientName,
  });
}

function shell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${CANVAS};font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:0 16px">
    <div style="text-align:center;padding:32px 0 24px">
      <div style="font-size:28px;font-weight:800;color:${GREEN};letter-spacing:-0.5px">AnyHealth</div>
    </div>
    ${inner}
    <div style="text-align:center;padding:24px 0;font-size:13px;color:${MUTED}">
      &copy; ${new Date().getFullYear()} AnyHealth &middot;
      <a href="${esc(APP_URL)}" style="color:${GREEN}">anyhealth.asia</a>
    </div>
  </div>
</body>
</html>`;
}

function detailRow(icon: string, label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 12px 10px 0;vertical-align:top;font-size:20px;width:32px">${icon}</td>
      <td style="padding:10px 0;vertical-align:top">
        <div style="font-size:12px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em">${esc(label)}</div>
        <div style="font-size:16px;font-weight:600;color:${INK};margin-top:2px">${value}</div>
      </td>
    </tr>`;
}

/* ─── Client confirmation ────────────────────────────────────────────────── */

export async function sendClientConfirmation(p: BookingEmailParams): Promise<MailResult> {
  const when = formatForHumans(p.startLocal, TIMEZONE);
  const duration = p.durationMinutes ?? 30;

  const html = shell(`
    <div style="background:#ffffff;border:1px solid ${LINE};border-radius:24px;padding:40px">
      <div style="text-align:center;margin-bottom:28px">
        <div style="font-size:40px;line-height:1">&#9989;</div>
        <h1 style="font-size:24px;font-weight:700;color:${INK};margin:12px 0 8px">You're booked, ${esc(p.clientName)}!</h1>
        <p style="font-size:16px;color:${MUTED};margin:0">Your initial consultation is confirmed.</p>
      </div>

      <table role="presentation" style="width:100%;border-collapse:collapse;background:${CANVAS};border-radius:16px;padding:8px">
        <tbody>
          ${detailRow('&#128197;', 'Date &amp; time', esc(when))}
          ${detailRow('&#9201;', 'Duration', `${duration} minutes`)}
          ${detailRow('&#128187;', 'Format', 'Online via Google Meet')}
        </tbody>
      </table>

      <div style="text-align:center;margin:28px 0 8px">
        <a href="${esc(p.meetUrl)}" style="display:inline-block;background:${GREEN};color:#ffffff;font-weight:700;font-size:16px;padding:16px 32px;border-radius:9999px;text-decoration:none">
          Join Google Meet
        </a>
        <div style="margin-top:12px;font-size:13px;color:${MUTED};word-break:break-all">
          <a href="${esc(p.meetUrl)}" style="color:${GREEN}">${esc(p.meetUrl)}</a>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid ${LINE};margin:28px 0">

      <h3 style="font-size:16px;font-weight:700;color:${INK};margin:0 0 12px">What to expect</h3>
      <ul style="margin:0 0 24px;padding-left:20px;color:${MUTED};font-size:15px;line-height:1.7">
        <li>A friendly ${duration}-minute call to understand your goals.</li>
        <li>How we can better support your patient outcomes.</li>
        <li>Plans and product lines that fit your practice.</li>
      </ul>

      <div style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;padding:16px;margin-bottom:24px">
        <p style="margin:0;font-size:14px;color:${GREEN_DARK}">
          <strong>Calendar invite attached.</strong> Open the .ics file to add this to
          Google Calendar, Outlook or Apple Calendar. You'll also get a Google Calendar
          invite to <strong>${esc(p.clientEmail)}</strong>.
        </p>
      </div>

      <p style="font-size:14px;color:${MUTED};text-align:center;margin:0">
        Need to reschedule? Just reply to this email &mdash;
        <a href="mailto:${esc(FROM_EMAIL)}" style="color:${GREEN}">${esc(FROM_EMAIL)}</a><br>
        <span style="font-size:12px">Booking ref ${esc(p.bookingRef)}</span>
      </p>
    </div>`);

  return sendMail({
    to: p.clientEmail,
    subject: `Confirmed: your AnyHealth consultation on ${formatDateOnly(p.startLocal, TIMEZONE)}`,
    html,
    icsContent: icsFor(p, false),
  });
}

/* ─── Internal notification ──────────────────────────────────────────────── */

export async function sendPractitionerNotification(
  p: BookingEmailParams
): Promise<MailResult> {
  const when = formatForHumans(p.startLocal, TIMEZONE);

  const row = (label: string, value: string) => `
    <tr style="border-bottom:1px solid ${LINE}">
      <td style="padding:12px 0;font-weight:600;color:${MUTED};width:150px;vertical-align:top">${esc(label)}</td>
      <td style="padding:12px 0;color:${INK}">${value}</td>
    </tr>`;

  const html = shell(`
    <div style="background:#ffffff;border:1px solid ${LINE};border-radius:24px;padding:40px">
      <h1 style="font-size:22px;font-weight:700;color:${GREEN};margin:0 0 8px">New booking</h1>
      <p style="font-size:15px;color:${MUTED};margin:0 0 24px">
        Someone booked a consultation through the AnyHealth scheduler.
      </p>

      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">
        <tbody>
          ${row('Date &amp; time', `<strong>${esc(when)}</strong>`)}
          ${row('Name', esc(p.clientName))}
          ${row('Email', `<a href="mailto:${esc(p.clientEmail)}" style="color:${GREEN}">${esc(p.clientEmail)}</a>`)}
          ${row('Phone', p.clientPhone ? esc(p.clientPhone) : '<span style="color:#999">not given</span>')}
          ${row('Role', p.role ? esc(p.role) : '<span style="color:#999">not given</span>')}
          ${row(
            'Challenges',
            p.challenges?.length
              ? p.challenges.map((c) => esc(c)).join('<br>')
              : '<span style="color:#999">none selected</span>'
          )}
          ${row('Booking ref', `<code style="font-size:13px">${esc(p.bookingRef)}</code>`)}
        </tbody>
      </table>

      <div style="margin-top:28px;text-align:center">
        <a href="${esc(p.meetUrl)}" style="display:inline-block;background:${GREEN};color:#ffffff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:9999px;text-decoration:none">
          Join as host
        </a>
      </div>

      <p style="margin:24px 0 0;font-size:13px;color:${MUTED};text-align:center">
        Saved in Supabase &middot;
        <a href="${esc(APP_URL)}/admin" style="color:${GREEN}">open the bookings list</a>
      </p>
    </div>`);

  return sendMail({
    to: NOTIFY_EMAIL,
    replyTo: p.clientEmail,
    subject: `New booking: ${p.clientName} — ${formatDateOnly(p.startLocal, TIMEZONE)}`,
    html,
    icsContent: icsFor(p, true),
  });
}

/**
 * Last-resort alert used when the booking could not be written to Supabase.
 * The whole point is that the answers exist somewhere no matter what fails.
 */
export async function sendPersistenceFailureAlert(
  p: BookingEmailParams & { reason: string; rawPayload: unknown }
): Promise<MailResult> {
  const html = shell(`
    <div style="background:#fff;border:2px solid #b3261e;border-radius:24px;padding:32px">
      <h1 style="font-size:20px;font-weight:700;color:#b3261e;margin:0 0 12px">
        Booking was NOT saved to Supabase
      </h1>
      <p style="font-size:15px;color:${MUTED};margin:0 0 16px">
        The consultation below was accepted but could not be written to the database.
        Record it by hand &mdash; this email is the only copy.
      </p>
      <p style="font-size:14px;color:${INK};margin:0 0 16px"><strong>Reason:</strong> ${esc(p.reason)}</p>
      <pre style="background:${CANVAS};border:1px solid ${LINE};border-radius:12px;padding:16px;font-size:13px;white-space:pre-wrap;word-break:break-word;color:${INK}">${esc(
        JSON.stringify(p.rawPayload, null, 2)
      )}</pre>
    </div>`);

  return sendMail({
    to: NOTIFY_EMAIL,
    subject: `[ACTION NEEDED] Booking not saved — ${p.clientName} (${p.bookingRef})`,
    html,
  });
}
