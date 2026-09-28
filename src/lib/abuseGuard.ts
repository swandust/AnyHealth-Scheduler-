import { getSupabase } from './supabase';

/**
 * Blocklist and rate limiting, both evaluated in Postgres.
 *
 * In-process counters are useless here: serverless functions do not share
 * memory, so a counter resets on every cold start and a burst walks straight
 * through. The database is the only shared state we have.
 */

export interface GuardDecision {
  allowed: boolean;
  reason?: string;
}

/** Check email, its domain, and the hashed IP against the manual blocklist. */
export async function checkBlocklist(params: {
  email: string;
  ipHash: string | null;
}): Promise<GuardDecision> {
  const db = getSupabase();
  if (!db) return { allowed: true };

  const email = params.email.toLowerCase();
  const domain = email.split('@')[1] ?? '';

  const values = [email, domain];
  if (params.ipHash) values.push(params.ipHash);

  const { data, error } = await db
    .from('blocklist')
    .select('kind, value, reason')
    .in('value', values)
    .limit(5);

  if (error) {
    // A missing table just means migration 002 has not been run. Never block
    // a booking because the guard itself is broken.
    console.error('[abuseGuard] blocklist lookup failed:', error.message);
    return { allowed: true };
  }

  const hit = (data ?? []).find(
    (row: { kind: string; value: string }) =>
      (row.kind === 'email' && row.value.toLowerCase() === email) ||
      (row.kind === 'domain' && row.value.toLowerCase() === domain) ||
      (row.kind === 'ip_hash' && row.value === params.ipHash)
  );

  return hit
    ? { allowed: false, reason: `blocklisted_${hit.kind}` }
    : { allowed: true };
}

export async function checkRateLimit(params: {
  ipHash: string | null;
  email: string;
}): Promise<GuardDecision> {
  const db = getSupabase();
  if (!db) return { allowed: true };

  const { data, error } = await db.rpc('check_booking_rate_limit', {
    p_ip_hash: params.ipHash,
    p_email: params.email,
    p_max_per_hour: Number(process.env.RATE_LIMIT_PER_HOUR ?? 3),
    p_max_per_day: Number(process.env.RATE_LIMIT_PER_DAY ?? 8),
    p_max_email_day: Number(process.env.RATE_LIMIT_EMAIL_PER_DAY ?? 3),
  });

  if (error) {
    console.error('[abuseGuard] rate limit check failed:', error.message);
    return { allowed: true };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) {
    return { allowed: false, reason: row.reason ?? 'rate_limited' };
  }
  return { allowed: true };
}

/**
 * Record an attempt. Rejected requests never become bookings, so without this
 * a flood leaves no trace anywhere — and it is what the rate limiter counts.
 */
export async function logAbuseEvent(params: {
  ipHash: string | null;
  email: string | null;
  kind: 'attempt' | 'blocked' | 'flagged';
  reason?: string;
  detail?: Record<string, unknown>;
  userAgent?: string | null;
}): Promise<void> {
  const db = getSupabase();
  if (!db) return;

  const { error } = await db.from('abuse_log').insert({
    ip_hash: params.ipHash,
    email: params.email,
    kind: params.kind,
    reason: params.reason ?? null,
    detail: params.detail ?? {},
    user_agent: params.userAgent ?? null,
  });

  if (error) console.error('[abuseGuard] logAbuseEvent failed:', error.message);
}
