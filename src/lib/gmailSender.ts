import MailComposer from 'nodemailer/lib/mail-composer';
import { getGoogleAccessToken, isGoogleConfigured } from './googleAuth';

/**
 * Send through the Gmail API using the same Google refresh token that creates
 * the calendar event.
 *
 * Why this rather than SMTP: there is no second credential. No app password to
 * rotate, nothing that breaks when a mail plan changes, and one health check
 * covers both the calendar and the mail. Sent messages also land in the
 * account's Sent folder, so there is a human-readable copy of every
 * confirmation next to the Supabase row.
 *
 * The MIME body is built by nodemailer's MailComposer — the same code path
 * that produces SMTP messages — so the two transports send byte-identical
 * mail and there is no hand-rolled MIME to get subtly wrong.
 */

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GMAIL_PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

export interface GmailMessage {
  from: { name: string; address: string };
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
  alternatives?: Array<{ contentType: string; content: string }>;
}

export function isGmailConfigured(): boolean {
  return isGoogleConfigured();
}

async function buildRawMessage(message: GmailMessage): Promise<string> {
  const mime = await new MailComposer(message).compile().build();
  // Gmail wants base64url, without padding.
  return mime.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendViaGmail(
  message: GmailMessage
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const token = await getGoogleAccessToken();
    const raw = await buildRawMessage(message);

    const res = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; status?: string };
      };
      const detail = body.error?.message ?? `HTTP ${res.status}`;

      // The single most likely failure after adding Gmail: the stored refresh
      // token predates the gmail.send scope, so say so rather than "403".
      const hint =
        res.status === 403 && /insufficient|scope|permission/i.test(detail)
          ? ' — the refresh token does not carry the gmail.send scope. Re-run `npm run google:auth`.'
          : res.status === 403 && /disabled|not enabled/i.test(detail)
            ? ' — enable the Gmail API in Google Cloud Console → APIs & Services → Library.'
            : '';

      return { ok: false, error: `Gmail API error: ${detail}${hint}` };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, messageId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Which mailbox the token actually sends as. Used by /api/admin/health, and
 * worth checking: Gmail silently rewrites the From header to this address if
 * FROM_EMAIL is not a verified "Send mail as" alias on the account.
 */
export async function getGmailProfile(): Promise<{
  ok: boolean;
  emailAddress?: string;
  error?: string;
}> {
  try {
    const token = await getGoogleAccessToken();
    const res = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      // profile needs a read scope; gmail.send alone cannot call it. That is
      // not a fault — sending still works.
      return { ok: false, error: body.error?.message ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as { emailAddress?: string };
    return { ok: true, emailAddress: data.emailAddress };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
