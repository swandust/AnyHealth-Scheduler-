import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Outbound mail via Zoho.
 *
 * Replaces Microsoft Graph `sendMail`. Everything is env-driven rather than
 * hard-coded to smtp.zoho.com, because Zoho has several endpoints you may end
 * up on and switching between them must not need a code change:
 *
 *   smtp.zoho.com        — Zoho Mail, global DC     (also .eu / .in / .com.au / .sa)
 *   smtp.zeptomail.com   — ZeptoMail, Zoho's transactional service
 *
 * If you are on the Zoho "Forever Free" plan, SMTP is not included — either
 * move to Mail Lite or point these vars at ZeptoMail. See SETUP.md, Step 3.
 */

const HOST = process.env.ZOHO_SMTP_HOST ?? 'smtp.zoho.com';
const PORT = Number(process.env.ZOHO_SMTP_PORT ?? 465);
const SECURE = (process.env.ZOHO_SMTP_SECURE ?? 'true') !== 'false';

export const FROM_EMAIL = process.env.FROM_EMAIL ?? 'contact@anyhealth.asia';
export const FROM_NAME = process.env.FROM_NAME ?? 'AnyHealth';
export const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? FROM_EMAIL;
export const REPLY_TO = process.env.REPLY_TO_EMAIL ?? FROM_EMAIL;

let _transport: Transporter | null | undefined;

export function isMailerConfigured(): boolean {
  return Boolean(process.env.ZOHO_SMTP_USER && process.env.ZOHO_SMTP_PASSWORD);
}

function getTransport(): Transporter | null {
  if (_transport !== undefined) return _transport;

  if (!isMailerConfigured()) {
    console.error(
      '[mailer] ZOHO_SMTP_USER / ZOHO_SMTP_PASSWORD are not set — no email will be sent.'
    );
    _transport = null;
    return null;
  }

  _transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE,            // true for 465, false for 587 (STARTTLS)
    requireTLS: !SECURE,
    auth: {
      user: process.env.ZOHO_SMTP_USER,
      pass: process.env.ZOHO_SMTP_PASSWORD,
    },
    // Serverless functions are short-lived; don't hold the socket open.
    pool: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return _transport;
}

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
}

/**
 * Send one email. Never throws — the caller records the outcome against the
 * booking row instead, so a mail outage is visible in Supabase rather than
 * silently swallowed the way it was before.
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  const transport = getTransport();
  if (!transport) return { ok: false, error: 'SMTP not configured' };

  const attachments: MailAttachment[] = [...(input.attachments ?? [])];
  if (input.icsContent) {
    attachments.push({
      filename: 'anyhealth-appointment.ics',
      content: input.icsContent,
      contentType: `text/calendar; charset=utf-8; method=${input.icsMethod ?? 'REQUEST'}`,
    });
  }

  try {
    const info = await transport.sendMail({
      from: { name: FROM_NAME, address: FROM_EMAIL },
      to: input.to,
      replyTo: input.replyTo ?? REPLY_TO,
      subject: input.subject,
      html: input.html,
      text: input.text ?? htmlToText(input.html),
      attachments,
      // Makes Gmail/Outlook show the invite inline rather than as a file only.
      alternatives: input.icsContent
        ? [
            {
              contentType: `text/calendar; charset=utf-8; method=${input.icsMethod ?? 'REQUEST'}`,
              content: input.icsContent,
            },
          ]
        : undefined,
    });

    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mailer] send failed:', message);
    return { ok: false, error: message };
  }
}

/** Used by /api/admin/health to prove the SMTP credentials still work. */
export async function verifyMailer(): Promise<MailResult> {
  const transport = getTransport();
  if (!transport) return { ok: false, error: 'SMTP not configured' };

  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
