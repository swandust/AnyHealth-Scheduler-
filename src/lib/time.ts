/**
 * Timezone helpers.
 *
 * The old code hard-coded "SGT is UTC+8" as `h - 8` arithmetic in five
 * different files, which is what made 11:30 PM slots roll over into the wrong
 * day. Everything now goes through `Intl`, so the booking timezone is a config
 * value (`BOOKING_TIMEZONE`) rather than a constant baked into the maths.
 */

export const TIMEZONE = process.env.BOOKING_TIMEZONE ?? 'Asia/Singapore';

const pad = (n: number) => String(n).padStart(2, '0');

/** Offset of `timeZone` from UTC, in ms, at the given instant. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }

  // `hour12: false` can render midnight as "24" in some ICU versions.
  const hour = Number(parts.hour) % 24;

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );

  return asIfUtc - instant.getTime();
}

/**
 * Turn a local wall-clock string ("2026-07-10T23:30:00") into the real instant.
 * Two passes so that a DST transition inside the window still resolves.
 */
export function localToUtc(localIso: string, timeZone: string = TIMEZONE): Date {
  const naive = Date.parse(`${localIso.length === 16 ? `${localIso}:00` : localIso}Z`);
  if (Number.isNaN(naive)) throw new Error(`Invalid local datetime: ${localIso}`);

  let utcMs = naive - offsetMsAt(new Date(naive), timeZone);
  utcMs = naive - offsetMsAt(new Date(utcMs), timeZone);
  return new Date(utcMs);
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** "YYYY-MM-DD" */
  date: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

/** Break an instant into its wall-clock parts in `timeZone`. */
export function toLocalParts(instant: Date, timeZone: string = TIMEZONE): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);

  return {
    year,
    month,
    day,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    date: `${year}-${pad(month)}-${pad(day)}`,
    weekday: Math.max(0, weekdays.indexOf(parts.weekday)),
  };
}

export function nowInZone(timeZone: string = TIMEZONE): LocalParts {
  return toLocalParts(new Date(), timeZone);
}

/**
 * Add minutes to a local wall-clock string, correctly rolling over midnight
 * and month ends. Returns another local wall-clock string.
 */
export function addMinutesLocal(
  localIso: string,
  minutes: number,
  timeZone: string = TIMEZONE
): string {
  const instant = new Date(localToUtc(localIso, timeZone).getTime() + minutes * 60_000);
  const p = toLocalParts(instant, timeZone);
  return `${p.date}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

/** "Friday, 10 July 2026 at 2:30 PM (SGT / MYT)" */
export function formatForHumans(localIso: string, timeZone: string = TIMEZONE): string {
  const instant = localToUtc(localIso, timeZone);

  const dateStr = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);

  const p = toLocalParts(instant, timeZone);
  const h12 = p.hour % 12 || 12;
  const ampm = p.hour < 12 ? 'AM' : 'PM';
  const label = timeZone === 'Asia/Singapore' ? ' (SGT / MYT)' : ` (${timeZone})`;

  return `${dateStr} at ${h12}:${pad(p.minute)} ${ampm}${label}`;
}

/** Just the date portion of {@link formatForHumans}. */
export function formatDateOnly(localIso: string, timeZone: string = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(localToUtc(localIso, timeZone));
}

/** "2:30 PM" */
export function formatTimeLabel(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  return `${h12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** ICS-style UTC stamp: 20260710T063000Z */
export function toIcsStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}
