import nodemailer, { type Transporter } from 'nodemailer';
import { getGmailProfile, isGmailConfigured, sendViaGmail } from './gmailSender';

/**
 * Outbound mail, over one of two transports.
 *
 *   gmail  (default)  Gmail API, using the same Google refresh token that
 *                     creates the calendar event. No mail password at all.
 *   smtp              Any SMTP server — Zoho Mail, ZeptoMail, anything else.
 *                     Kept as a fallback for when the From address cannot be
 *                     sent as from the Google account.
 *
 * Set MAIL_TRANSPORT to force one. Left unset, Gmail is used when Google is
 * configured, otherwise SMTP.
 */

export type MailTransport = 'gmail' | 'smtp' | 'none';

const HOST = process.env.SMTP_HOST ?? process.env.ZOHO_SMTP_HOST ?? 'smtp.zoho.com';
const PORT = Number(process.env.SMTP_PORT ?? process.env.ZOHO_SMTP_PORT ?? 465);
const SECURE = (process.env.SMTP_SECURE ?? process.env.ZOHO_SMTP_SECURE ?? 'true') !== 'false';
const SMTP_USER = process.env.SMTP_USER ?? process.env.ZOHO_SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD ?? process.env.ZOHO_SMTP_PASSWORD;

export const FROM_EMAIL = process.env.FROM_EMAIL ?? 'contact@anyhealth.asia';
export const FROM_NAME = process.env.FROM_NAME ?? 'AnyHealth';
export const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? FROM_EMAIL;
export const REPLY_TO = process.env.REPLY_TO_EMAIL ?? FROM_EMAIL;

export function isSmtpConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASSWORD);
}

export function isMailerConfigured(): boolean {
  return activeTransport() !== 'none';
}

export function activeTransport(): MailTransport {
  const forced = process.env.MAIL_TRANSPORT?.toLowerCase();

  if (forced === 'gmail') return isGmailConfigured() ? 'gmail' : 'none';
  if (forced === 'smtp') return isSmtpConfigured() ? 'smtp' : 'none';

  if (isGmailConfigured()) return 'gmail';
  if (isSmtpConfigured()) return 'smtp';
  return 'none';
}

/* ─── SMTP transport (fallback) ──────────────────────────────────────────── */

let _transport: Transporter | null | undefined;

function getSmtpTransport(): Transporter | null {
  if (_transport !== undefined) return _transport;

  if (!isSmtpConfigured()) {
    _transport = null;
    return null;
  }

  _transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE,        // true for 465, false for 587 (STARTTLS)
    requireTLS: !SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    pool: false,           // serverless functions are short-lived
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return _transport;
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

export interface MailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface MailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  /** Calendar invites ride as a text/calendar alternative, not just a file. */
  icsContent?: string;
  icsMethod?: 'REQUEST' | 'CANCEL';
}

export interface MailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  transport?: MailTransport;
}

/**
 * Send one email. Never throws — the caller records the outcome against the
 * booking row instead, so a mail outage is visible in Supabase rather than
 * silently swallowed the way it was before.
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  const transport = activeTransport();

  if (transport === 'none') {
    console.error(
      '[mailer] No mail transport configured — set up Google (preferred) or SMTP. ' +
        'No email was sent.'
    );
    return { ok: false, error: 'No mail transport configured', transport };
  }

  const icsContentType = `text/calendar; charset=utf-8; method=${input.icsMethod ?? 'REQUEST'}`;

  const attachments: MailAttachment[] = [...(input.attachments ?? [])];
  if (input.icsContent) {
    attachments.push({
      filename: 'anyhealth-appointment.ics',
      content: input.icsContent,
      contentType: icsContentType,
    });
  }

  // Showing the invite inline (rather than only as a file) is what makes Gmail
  // and Outlook render RSVP buttons.
  const alternatives = input.icsContent
    ? [{ contentType: icsContentType, content: input.icsContent }]
    : undefined;

  const common = {
    from: { name: FROM_NAME, address: FROM_EMAIL },
    to: input.to,
    replyTo: input.replyTo ?? REPLY_TO,
    subject: input.subject,
    html: input.html,
    text: input.text ?? htmlToText(input.html),
    attachments,
    alternatives,
  };

  if (transport === 'gmail') {
    const result = await sendViaGmail(common);
    if (!result.ok) console.error('[mailer] Gmail send failed:', result.error);
    return { ...result, transport };
  }

  const smtp = getSmtpTransport();
  if (!smtp) return { ok: false, error: 'SMTP not configured', transport: 'none' };

  try {
    const info = await smtp.sendMail(common);
    return { ok: true, messageId: info.messageId, transport };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mailer] SMTP send failed:', message);
    return { ok: false, error: message, transport };
  }
}

/** Used by /api/admin/health to prove mail still works before a customer finds out. */
export async function verifyMailer(): Promise<MailResult> {
  const transport = activeTransport();

  if (transport === 'none') {
    return { ok: false, error: 'No mail transport configured', transport };
  }

  if (transport === 'gmail') {
    const profile = await getGmailProfile();

    // gmail.send alone cannot read the profile; that is not a failure, it just
    // means we cannot name the mailbox. A bad token would have failed earlier,
    // inside getGoogleAccessToken.
    if (!profile.ok) {
      return {
        ok: true,
        transport,
        error: `Gmail reachable; mailbox not readable with the gmail.send scope (${profile.error})`,
      };
    }

    const mismatch =
      profile.emailAddress &&
      profile.emailAddress.toLowerCase() !== FROM_EMAIL.toLowerCase();

    return {
      ok: true,
      transport,
      error: mismatch
        ? `Sending as ${profile.emailAddress}; FROM_EMAIL is ${FROM_EMAIL}. ` +
          `Gmail will rewrite the From header unless ${FROM_EMAIL} is a verified ` +
          `"Send mail as" alias on that account.`
        : undefined,
    };
  }

  const smtp = getSmtpTransport();
  if (!smtp) return { ok: false, error: 'SMTP not configured', transport: 'none' };

  try {
    await smtp.verify();
    return { ok: true, transport };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      transport,
    };
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
