import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Bot defences that cost a real person nothing.
 *
 * Layering, weakest-to-strongest:
 *   1. Honeypot field      — a hidden input. Humans never fill it in.
 *   2. Challenge token     — HMAC issued when the wizard loads, checked on
 *                            submit. A script POSTing straight at /api/book
 *                            has no token and cannot forge one.
 *   3. Minimum dwell time  — the token carries its issue time, signed, so the
 *                            timing cannot be faked by editing a payload field.
 *   4. Rate limit          — counted in Postgres, see abuseGuard.ts.
 *   5. Blocklist           — manual, see abuseGuard.ts.
 *
 * Anything softer than these is scored, not blocked. Losing a real enquiry to
 * an over-eager filter would be worse than the spam.
 */

const TOKEN_VERSION = 'v1';

/** Minimum time between the form loading and submitting. */
export const MIN_DWELL_MS = Number(process.env.MIN_FORM_SECONDS ?? 8) * 1000;
/** Tokens older than this are stale — someone left the tab open for hours. */
export const MAX_TOKEN_AGE_MS = 6 * 60 * 60 * 1000;

function secret(): string | null {
  return process.env.BOOKING_SECRET ?? process.env.ADMIN_TOKEN ?? null;
}

export function isChallengeEnabled(): boolean {
  return Boolean(secret());
}

/** IPs are hashed, never stored raw — they are personal data under PDPA. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = secret() ?? 'anyhealth-fallback-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || null;
  return headers.get('x-real-ip') ?? null;
}

/* ─── Challenge token ────────────────────────────────────────────────────── */

export function issueChallenge(): string | null {
  const key = secret();
  if (!key) return null;

  const issuedAt = Date.now();
  const nonce = randomBytes(9).toString('base64url');
  const payload = `${TOKEN_VERSION}.${issuedAt}.${nonce}`;
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export type ChallengeResult =
  | { ok: true; dwellMs: number }
  | { ok: false; reason: string };

export function verifyChallenge(token: unknown): ChallengeResult {
  const key = secret();
  // No secret configured: cannot verify, so do not pretend to. The route
  // flags this rather than rejecting everyone.
  if (!key) return { ok: false, reason: 'challenge_disabled' };

  if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing_token' };

  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: 'malformed_token' };
  }

  const [version, issuedAtRaw, nonce, signature] = parts;
  const expected = createHmac('sha256', key)
    .update(`${version}.${issuedAtRaw}.${nonce}`)
    .digest('base64url');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'malformed_token' };

  const age = Date.now() - issuedAt;
  if (age < 0) return { ok: false, reason: 'token_from_the_future' };
  if (age > MAX_TOKEN_AGE_MS) return { ok: false, reason: 'token_expired' };

  return { ok: true, dwellMs: age };
}

/* ─── Risk scoring ───────────────────────────────────────────────────────── */

export interface RiskAssessment {
  score: number;
  flags: string[];
}

/**
 * Soft signals only. Each adds to a score that surfaces in /admin; none of
 * them rejects a booking on its own.
 */
export function assessRisk(input: {
  dwellMs: number | null;
  emailFlags: string[];
  hasVisitorId: boolean;
  hasReferrer: boolean;
  userAgent: string | null;
  challengeReason?: string;
}): RiskAssessment {
  const flags: string[] = [];
  let score = 0;

  if (input.dwellMs !== null && input.dwellMs < MIN_DWELL_MS) {
    flags.push('submitted_too_fast');
    score += 40;
  }

  for (const flag of input.emailFlags) {
    flags.push(flag);
    if (flag === 'possible_typo') score += 25;
    else if (flag === 'role_address') score += 10;
    else if (flag === 'disposable_email') score += 50;
  }

  const ua = input.userAgent ?? '';
  if (!ua) {
    flags.push('no_user_agent');
    score += 30;
  } else if (/bot|crawler|spider|curl|wget|python-requests|httpclient|scrapy|headless/i.test(ua)) {
    flags.push('automation_user_agent');
    score += 45;
  }

  // Weak on its own — plenty of real people arrive with tracking blocked —
  // so it scores low and only matters alongside something else.
  if (!input.hasVisitorId && !input.hasReferrer) {
    flags.push('no_visitor_no_referrer');
    score += 15;
  }

  if (input.challengeReason && input.challengeReason !== 'challenge_disabled') {
    flags.push(`challenge_${input.challengeReason}`);
    score += 35;
  }

  return { score: Math.min(score, 100), flags };
}

/** A hidden field. Any value at all means a script filled the form. */
export function honeypotTripped(payload: Record<string, unknown>): boolean {
  const value = payload.company_website ?? payload.honeypot;
  return typeof value === 'string' && value.trim().length > 0;
}
