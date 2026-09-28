import { resolveMx } from 'node:dns/promises';

/**
 * Server-side email checking, used to gate the contact step of the wizard.
 *
 * What this can and cannot do, so nobody expects more than it gives:
 *
 *   CAN   reject malformed addresses
 *   CAN   reject domains with no mail exchanger — catches invented domains and
 *         typos like gmial.com, gmail.co, hotmial.com
 *   CAN   reject known disposable/throwaway providers
 *   CAN   flag role addresses (info@, admin@) which are rarely a real person
 *   CANNOT prove a specific mailbox exists. No provider exposes that: an API
 *         that answered it would be an account-enumeration oracle for
 *         spammers. Gmail accepts every address at SMTP RCPT stage for the
 *         same reason. The ONLY proof of control is sending a code to it,
 *         which is what REQUIRE_EMAIL_CODE turns on.
 */

const SYNTAX_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Throwaway providers. Not exhaustive — the MX check catches most of the rest. */
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com',
  'spamgourmet.com', 'tempinbox.com', 'emailondeck.com', 'burnermail.io',
  'mohmal.com', 'grr.la', 'spam4.me', 'inboxkitten.com', 'tmpmail.org',
  'mailsac.com', 'harakirimail.com', 'anonaddy.me', 'byom.de',
]);

/** Shared mailboxes — allowed, but worth flagging: rarely an individual. */
const ROLE_LOCALPARTS = new Set([
  'info', 'admin', 'support', 'sales', 'contact', 'hello', 'enquiry',
  'enquiries', 'office', 'help', 'billing', 'accounts', 'noreply',
  'no-reply', 'postmaster', 'webmaster', 'marketing', 'team',
]);

/** Typo targets. Ordered by how often people actually mistype them. */
const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.sg', 'outlook.com',
  'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'proton.me',
  'protonmail.com', 'zoho.com', 'aol.com', 'msn.com', 'qq.com', '163.com',
  'singnet.com.sg', 'starhub.net.sg',
];

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,                                        // deletion
        prev[j - 1] + 1,                                    // insertion
        last + (a[i - 1] === b[j - 1] ? 0 : 1)              // substitution
      );
      last = tmp;
    }
  }
  return prev[b.length];
}

/** "jo@gmial.com" → "jo@gmail.com". Returns null when nothing is close enough. */
export function suggestCorrection(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (COMMON_DOMAINS.includes(domain)) return null;

  let best: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of COMMON_DOMAINS) {
    const distance = levenshtein(domain, candidate);
    // Allow 2 edits on longer domains, 1 on short ones, so "qq.com" does not
    // get "corrected" into something unrelated.
    const limit = candidate.length > 9 ? 2 : 1;
    if (distance <= limit && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best ? `${local}@${best}` : null;
}

export type EmailVerdict = 'ok' | 'invalid_syntax' | 'no_mx' | 'disposable' | 'dns_error';

export interface EmailCheck {
  /** Whether the wizard should let them continue. */
  valid: boolean;
  /**
   * True when the address resolves but looks like a typo, so the user must
   * confirm before continuing.
   *
   * This is not paranoia: gmail.co and hotmial.com are registered by
   * typosquatters and DO have working MX records, so the MX check passes them
   * happily. Without a confirmation step the confirmation email sails off to
   * a squatter and the lead is simply gone — indistinguishable from the email
   * failures this whole project exists to stop.
   */
  requiresConfirmation?: boolean;
  verdict: EmailVerdict;
  /** Shown to the user. */
  message?: string;
  /** "Did you mean …?" */
  suggestion?: string;
  /** Non-blocking notes that feed the booking's risk score. */
  flags: string[];
}

const mxCache = new Map<string, { ok: boolean; at: number }>();
const MX_TTL_MS = 10 * 60 * 1000;

async function domainHasMx(domain: string): Promise<boolean | null> {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_TTL_MS) return cached.ok;

  try {
    const records = await resolveMx(domain);
    const ok = Array.isArray(records) && records.length > 0;
    mxCache.set(domain, { ok, at: Date.now() });
    return ok;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // NXDOMAIN / no records = the domain genuinely cannot receive mail.
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      mxCache.set(domain, { ok: false, at: Date.now() });
      return false;
    }
    // Timeout or resolver failure — unknown, not invalid. Never block on this.
    return null;
  }
}

export async function checkEmail(raw: string): Promise<EmailCheck> {
  const email = String(raw ?? '').trim().toLowerCase();
  const flags: string[] = [];

  if (!SYNTAX_RE.test(email) || email.length > 254) {
    return {
      valid: false,
      verdict: 'invalid_syntax',
      message: 'That email address does not look right.',
      suggestion: suggestCorrection(email) ?? undefined,
      flags,
    };
  }

  const [localPart, domain] = email.split('@');

  if (DISPOSABLE.has(domain)) {
    return {
      valid: false,
      verdict: 'disposable',
      message: 'Please use a permanent email address so we can send your confirmation.',
      flags: ['disposable_email'],
    };
  }

  if (ROLE_LOCALPARTS.has(localPart)) flags.push('role_address');

  const hasMx = await domainHasMx(domain);

  if (hasMx === false) {
    return {
      valid: false,
      verdict: 'no_mx',
      message: `"${domain}" cannot receive email. Please check the spelling.`,
      suggestion: suggestCorrection(email) ?? undefined,
      flags,
    };
  }

  if (hasMx === null) {
    // Degrade open: a flaky resolver must never cost a real booking.
    flags.push('mx_check_unavailable');
  }

  const suggestion = suggestCorrection(email);
  if (suggestion) flags.push('possible_typo');

  return {
    valid: true,
    verdict: 'ok',
    // The domain resolving does not mean they meant it — see the note on
    // requiresConfirmation.
    requiresConfirmation: Boolean(suggestion),
    suggestion: suggestion ?? undefined,
    message: suggestion ? `Did you mean ${suggestion}?` : undefined,
    flags,
  };
}
