import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client.
 *
 * Uses the SERVICE ROLE key, so it bypasses RLS — it must never be imported
 * into a Client Component. Every caller in this app is a Route Handler.
 *
 * If the env vars are missing the client is `null` and every helper below
 * degrades to a no-op that logs loudly, so a mis-configured deploy still takes
 * bookings instead of 500-ing. Check `/api/admin/health` to see the current state.
 */

let _client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      '[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — ' +
        'bookings will NOT be persisted. Fix this before going live.'
    );
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'anyhealth-scheduler' } },
  });
  return _client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type BookingStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'ok' | 'failed' | 'skipped';
export type MailStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface BookingRow {
  id: string;
  booking_ref: string;
  status: BookingStatus;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  role: string | null;
  challenges: string[];
  answers: Record<string, unknown>;
  slot_date: string;
  slot_time: string;
  start_local: string;
  end_local: string;
  start_utc: string;
  end_utc: string;
  timezone: string;
  duration_minutes: number;
  meet_url: string | null;
  google_event_id: string | null;
  google_html_link: string | null;
  calendar_status: StepStatus;
  calendar_error: string | null;
  client_email_status: MailStatus;
  practitioner_email_status: MailStatus;
  email_error: string | null;
  source: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewBooking {
  booking_ref: string;
  client_name: string;
  client_email: string;
  client_phone?: string | null;
  role?: string | null;
  challenges?: string[];
  answers: Record<string, unknown>;
  slot_date: string;
  slot_time: string;
  start_local: string;
  end_local: string;
  start_utc: string;
  end_utc: string;
  timezone?: string;
  duration_minutes?: number;
  source?: string;
  user_agent?: string | null;
}

/** Postgres unique-violation — raised by the `bookings_one_per_slot` index. */
const PG_UNIQUE_VIOLATION = '23505';

export class SlotTakenError extends Error {
  constructor() {
    super('That time was just booked by someone else. Please pick another slot.');
    this.name = 'SlotTakenError';
  }
}

/* ─── Writes ─────────────────────────────────────────────────────────────── */

/**
 * Insert the booking BEFORE any external call is made. This is the single most
 * important line in the app: whatever the calendar and mail calls do next, the
 * answers are already safe.
 *
 * Returns `null` (rather than throwing) when Supabase is unreachable, so a
 * database outage cannot stop a customer booking a call.
 * Throws `SlotTakenError` if the slot was taken in the meantime.
 */
export async function insertBooking(booking: NewBooking): Promise<BookingRow | null> {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('bookings')
    .insert({
      ...booking,
      challenges: booking.challenges ?? [],
      timezone: booking.timezone ?? 'Asia/Singapore',
      duration_minutes: booking.duration_minutes ?? 30,
      source: booking.source ?? 'web',
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) throw new SlotTakenError();
    console.error('[supabase] insertBooking failed:', error.message, error.details);
    return null;
  }

  return data as BookingRow;
}

export async function updateBooking(
  bookingId: string | null,
  patch: Partial<BookingRow>
): Promise<void> {
  const db = getSupabase();
  if (!db || !bookingId) return;

  const { error } = await db.from('bookings').update(patch).eq('id', bookingId);
  if (error) console.error('[supabase] updateBooking failed:', error.message);
}

/**
 * Append to the audit trail. Never throws — a logging failure must not break a
 * booking. Fire-and-forget is fine at the call site.
 */
export async function logBookingEvent(params: {
  bookingId: string | null;
  bookingRef: string;
  step: string;
  ok: boolean;
  message?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const db = getSupabase();
  if (!db) return;

  const { error } = await db.from('booking_events').insert({
    booking_id: params.bookingId,
    booking_ref: params.bookingRef,
    step: params.step,
    ok: params.ok,
    message: params.message ?? null,
    detail: params.detail ?? null,
  });

  if (error) console.error('[supabase] logBookingEvent failed:', error.message);
}

/* ─── Reads ──────────────────────────────────────────────────────────────── */

/** Slots already taken between two instants, used to grey out the calendar. */
export async function getBookedSlotStarts(
  fromUtcIso: string,
  toUtcIso: string
): Promise<string[]> {
  const db = getSupabase();
  if (!db) return [];

  const { data, error } = await db
    .from('bookings')
    .select('start_utc')
    .in('status', ['pending', 'confirmed'])
    .gte('start_utc', fromUtcIso)
    .lt('start_utc', toUtcIso);

  if (error) {
    console.error('[supabase] getBookedSlotStarts failed:', error.message);
    return [];
  }

  return (data ?? []).map((r: { start_utc: string }) => new Date(r.start_utc).toISOString());
}

export async function listBookings(opts: {
  limit?: number;
  from?: string;
  status?: BookingStatus;
} = {}): Promise<BookingRow[]> {
  const db = getSupabase();
  if (!db) return [];

  let query = db
    .from('bookings')
    .select('*')
    .order('start_utc', { ascending: false })
    .limit(opts.limit ?? 200);

  if (opts.from) query = query.gte('start_utc', opts.from);
  if (opts.status) query = query.eq('status', opts.status);

  const { data, error } = await query;
  if (error) {
    console.error('[supabase] listBookings failed:', error.message);
    return [];
  }
  return (data ?? []) as BookingRow[];
}
