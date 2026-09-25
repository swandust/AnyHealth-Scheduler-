#!/usr/bin/env node
/**
 * Rebuild the booking history that was never written down.
 *
 * Before Supabase, a booking existed only as (a) a Zoom meeting, (b) an Outlook
 * calendar event and (c) two emails. When mail broke, nothing was left. Both
 * surviving traces can still be pulled back in:
 *
 *   npm run recover -- --zoom              # every past meeting on the Zoom account
 *   npm run recover -- --ics ./export.ics  # an .ics exported from Outlook/any calendar
 *
 * Add --dry-run to print what would be written without touching the database,
 * and --csv to dump the same rows as CSV.
 *
 * Recovered rows are marked source='zoom-backfill' / 'ics-backfill' so they are
 * easy to tell apart from real bookings. Re-running is safe: rows are keyed on
 * booking_ref and existing ones are skipped.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

/* ─── env ────────────────────────────────────────────────────────────────── */

function loadEnvFile(name) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const fileEnv = { ...loadEnvFile('.env'), ...loadEnvFile('.env.local') };
const env = (k) => process.env[k] || fileEnv[k];

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const DRY_RUN = has('--dry-run');
const AS_CSV = has('--csv');
const TIMEZONE = env('BOOKING_TIMEZONE') ?? 'Asia/Singapore';
const DURATION = Number(env('SLOT_DURATION_MINUTES') ?? 30);

/* ─── local-time helpers (mirrors src/lib/time.ts) ───────────────────────── */

const pad = (n) => String(n).padStart(2, '0');

function toLocalParts(instant, timeZone = TIMEZONE) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${pad(hour)}:${p.minute}`,
    local: `${p.year}-${p.month}-${p.day}T${pad(hour)}:${p.minute}:00`,
  };
}

/* ─── source 1: Zoom ─────────────────────────────────────────────────────── */

async function zoomToken() {
  const accountId = env('ZOOM_ACCOUNT_ID');
  const clientId = env('ZOOM_CLIENT_ID');
  const clientSecret = env('ZOOM_CLIENT_SECRET');

  if (!accountId || !clientId || !clientSecret) {
    throw new Error(
      'Zoom recovery needs the OLD credentials: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ' +
      'ZOOM_CLIENT_SECRET. They are only used to read past meetings.'
    );
  }

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Zoom OAuth failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function fetchZoomMeetings() {
  const token = await zoomToken();
  const meetings = [];

  // "previous_meetings" only covers meetings that actually started. Scheduled
  // ones that nobody joined show up under "scheduled", so read both.
  for (const type of ['previous_meetings', 'scheduled', 'upcoming']) {
    let nextPageToken = '';
    do {
      const url =
        `https://api.zoom.us/v2/users/me/meetings?type=${type}&page_size=300` +
        (nextPageToken ? `&next_page_token=${nextPageToken}` : '');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        console.warn(`  ! Zoom "${type}" listing failed: ${res.status} ${await res.text()}`);
        break;
      }

      const data = await res.json();
      meetings.push(...(data.meetings ?? []).map((m) => ({ ...m, _listType: type })));
      nextPageToken = data.next_page_token ?? '';
    } while (nextPageToken);
  }

  // De-duplicate: a meeting can appear in more than one listing.
  const byId = new Map();
  for (const m of meetings) if (!byId.has(m.id)) byId.set(m.id, m);

  return [...byId.values()].filter((m) =>
    /anyhealth/i.test(m.topic ?? '')
  );
}

function rowFromZoom(m) {
  // Topic format was: "AnyHealth Initial Consultation – {clientName}"
  const name =
    (m.topic ?? '').split(/[–—-]/).slice(1).join('-').trim() || 'Unknown (from Zoom topic)';

  const start = new Date(m.start_time);
  const end = new Date(start.getTime() + (m.duration ?? DURATION) * 60_000);
  const s = toLocalParts(start);
  const e = toLocalParts(end);

  return {
    booking_ref: `ZOOM-${m.id}`,
    status: 'confirmed',
    client_name: name,
    client_email: null,          // Zoom never stored it
    role: null,
    challenges: [],
    answers: {
      recoveredFrom: 'zoom',
      note: 'Backfilled from the Zoom account. Email, role and challenges were never stored by Zoom.',
      zoomMeetingId: m.id,
      zoomTopic: m.topic,
      zoomJoinUrl: m.join_url,
      zoomListType: m._listType,
    },
    slot_date: s.date,
    slot_time: s.time,
    start_local: s.local,
    end_local: e.local,
    start_utc: start.toISOString(),
    end_utc: end.toISOString(),
    timezone: TIMEZONE,
    duration_minutes: m.duration ?? DURATION,
    meet_url: m.join_url ?? null,
    calendar_status: 'skipped',
    client_email_status: 'skipped',
    practitioner_email_status: 'skipped',
    source: 'zoom-backfill',
  };
}

/* ─── source 2: an exported .ics ─────────────────────────────────────────── */

function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeIcs(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseIcsDate(raw) {
  // 20260710T063000Z  |  20260710T143000 (floating)  |  20260710 (all-day)
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', sec = '00', z] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  if (z) return new Date(asUtc);
  // No zone marker: treat the wall clock as the booking timezone.
  const guess = new Date(asUtc);
  const shown = toLocalParts(guess);
  const drift = Date.parse(`${shown.local}Z`) - asUtc;
  return new Date(asUtc - drift);
}

function parseIcsFile(path) {
  const text = unfoldIcs(readFileSync(path, 'utf8'));
  const blocks = text.split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]);
  const rows = [];

  for (const block of blocks) {
    const field = (name) => {
      const line = block
        .split('\n')
        .find((l) => l.toUpperCase().startsWith(`${name};`) || l.toUpperCase().startsWith(`${name}:`));
      return line ? { params: line.slice(0, line.indexOf(':')), value: unescapeIcs(line.slice(line.indexOf(':') + 1)) } : null;
    };

    const summary = field('SUMMARY')?.value ?? '';
    if (!/anyhealth/i.test(summary)) continue;

    const dtstart = field('DTSTART');
    const dtend = field('DTEND');
    if (!dtstart) continue;

    const start = parseIcsDate(dtstart.value.trim());
    if (!start || Number.isNaN(start.getTime())) continue;
    const end =
      (dtend && parseIcsDate(dtend.value.trim())) ??
      new Date(start.getTime() + DURATION * 60_000);

    const description = field('DESCRIPTION')?.value ?? '';
    const attendeeLine = block.split('\n').find((l) => l.toUpperCase().startsWith('ATTENDEE'));
    const attendeeEmail = attendeeLine?.match(/mailto:([^\s;,]+)/i)?.[1] ?? null;
    const attendeeName = attendeeLine?.match(/CN=([^;:]+)/i)?.[1] ?? null;

    const bodyEmail = description.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
    const name =
      attendeeName ??
      summary.split(/[–—-]/).slice(1).join('-').trim() ??
      'Unknown (from calendar)';

    const uid = field('UID')?.value ?? `${start.toISOString()}-${summary}`;
    const s = toLocalParts(start);
    const e = toLocalParts(end);

    rows.push({
      booking_ref: `ICS-${uid}`.slice(0, 120),
      status: 'confirmed',
      client_name: name || 'Unknown (from calendar)',
      client_email: attendeeEmail ?? bodyEmail,
      role: description.match(/Goal[:\s]+(.+)/i)?.[1]?.trim()
         ?? description.match(/Role[:\s]+(.+)/i)?.[1]?.trim()
         ?? null,
      challenges: (description.match(/Challenges[:\s]+(.+)/i)?.[1] ?? '')
        .split(',').map((c) => c.trim()).filter(Boolean),
      answers: {
        recoveredFrom: 'ics',
        note: 'Backfilled from an exported calendar file.',
        summary,
        description,
        uid,
      },
      slot_date: s.date,
      slot_time: s.time,
      start_local: s.local,
      end_local: e.local,
      start_utc: start.toISOString(),
      end_utc: end.toISOString(),
      timezone: TIMEZONE,
      duration_minutes: Math.max(
        5,
        Math.round((end.getTime() - start.getTime()) / 60_000)
      ),
      meet_url: description.match(/https?:\/\/\S*(zoom\.us|meet\.google\.com)\S*/i)?.[0] ?? null,
      calendar_status: 'skipped',
      client_email_status: 'skipped',
      practitioner_email_status: 'skipped',
      source: 'ics-backfill',
    });
  }

  return rows;
}

/* ─── output ─────────────────────────────────────────────────────────────── */

function printCsv(rows) {
  const cols = ['booking_ref', 'slot_date', 'slot_time', 'client_name', 'client_email', 'role', 'meet_url', 'source'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  console.log(cols.join(','));
  for (const r of rows) console.log(cols.map((c) => cell(r[c])).join(','));
}

async function writeRows(rows) {
  const url = env('SUPABASE_URL') ?? env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to write rows.');
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  let inserted = 0;
  let skipped = 0;
  const problems = [];

  for (const row of rows) {
    const { error } = await db.from('bookings').insert(row);
    if (!error) {
      inserted++;
    } else if (error.code === '23505') {
      skipped++; // already recovered, or the slot is taken by a real booking
    } else {
      problems.push(`${row.booking_ref}: ${error.message}`);
    }
  }

  console.log(`\n  inserted: ${inserted}\n  skipped (already present): ${skipped}`);
  if (problems.length) {
    console.log(`  problems: ${problems.length}`);
    for (const p of problems.slice(0, 20)) console.log(`    - ${p}`);
  }
}

/* ─── main ───────────────────────────────────────────────────────────────── */

const icsPath = valueOf('--ics');

if (!has('--zoom') && !icsPath) {
  console.log(`
Rebuild lost booking history.

  npm run recover -- --zoom               read past meetings from the old Zoom account
  npm run recover -- --ics ./export.ics   read an exported calendar file

  --dry-run   show what would be written, change nothing
  --csv       print the rows as CSV instead of a table
`);
  process.exit(0);
}

let rows = [];

if (has('--zoom')) {
  console.log('Reading past meetings from Zoom …');
  const meetings = await fetchZoomMeetings();
  console.log(`  found ${meetings.length} AnyHealth meeting(s)`);
  rows.push(...meetings.map(rowFromZoom));
}

if (icsPath) {
  console.log(`Reading ${icsPath} …`);
  const parsed = parseIcsFile(resolve(process.cwd(), icsPath));
  console.log(`  found ${parsed.length} AnyHealth event(s)`);
  rows.push(...parsed);
}

rows.sort((a, b) => a.start_utc.localeCompare(b.start_utc));

if (rows.length === 0) {
  console.log('\nNothing to recover.');
  process.exit(0);
}

if (AS_CSV) {
  printCsv(rows);
} else {
  console.log('');
  for (const r of rows) {
    console.log(
      `  ${r.slot_date} ${r.slot_time}  ${String(r.client_name).padEnd(28)} ` +
      `${r.client_email ?? '(no email on record)'}  [${r.source}]`
    );
  }
}

if (DRY_RUN) {
  console.log(`\nDry run — nothing written. ${rows.length} row(s) would be inserted.`);
  process.exit(0);
}

await writeRows(rows);
