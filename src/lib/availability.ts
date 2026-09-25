import { getBusyIntervals, isGoogleConfigured } from './googleCalendar';
import { getBookedSlotStarts } from './supabase';
import {
  TIMEZONE,
  addMinutesLocal,
  formatTimeLabel,
  localToUtc,
  toLocalParts,
} from './time';

export const DURATION_MINUTES = Number(process.env.SLOT_DURATION_MINUTES ?? 30);

/** [startHour, startMinute, endHour, endMinute] — bookable windows, local time. */
const BLOCKS: Array<[number, number, number, number]> = [
  [8, 0, 12, 0],   // Morning    08:00 – 12:00
  [14, 0, 18, 0],  // Afternoon  14:00 – 18:00
  [21, 0, 24, 0],  // Evening    21:00 – 24:00
];

/** Don't offer a slot that starts within this many minutes from now. */
const MIN_NOTICE_MINUTES = Number(process.env.MIN_NOTICE_MINUTES ?? 60);

const pad = (n: number) => String(n).padStart(2, '0');

export interface TimeSlot {
  label: string;     // "8:00 AM"
  value: string;     // "08:00"
  startIso: string;  // "2026-07-10T08:00:00"  (local wall clock)
  endIso: string;    // "2026-07-10T08:30:00"
}

/** Every slot the schedule could theoretically offer on that date. */
function generateSlots(dateStr: string): TimeSlot[] {
  const slots: TimeSlot[] = [];

  for (const [startH, startM, endH, endM] of BLOCKS) {
    const blockEnd = endH * 60 + endM;
    let cursor = startH * 60 + startM;

    while (cursor + DURATION_MINUTES <= blockEnd) {
      const h = Math.floor(cursor / 60);
      const m = cursor % 60;
      const startIso = `${dateStr}T${pad(h)}:${pad(m)}:00`;

      slots.push({
        label: formatTimeLabel(h, m),
        value: `${pad(h)}:${pad(m)}`,
        startIso,
        // addMinutesLocal rolls the date correctly for the 23:30 → 00:00 case.
        endIso: addMinutesLocal(startIso, DURATION_MINUTES),
      });

      cursor += DURATION_MINUTES;
    }
  }

  return slots;
}

/**
 * Bookable slots for a date, with everything already taken removed.
 *
 * Two independent sources are subtracted:
 *   1. Google Calendar free/busy — so a manually-added meeting blocks the slot.
 *   2. Supabase bookings — so a booking still mid-flight blocks the slot even
 *      if Google has not caught up yet.
 *
 * If a source errors the slot list is NOT emptied; Supabase's unique index on
 * `start_utc` is the real guard against double-booking, so degrading open is
 * safe here and stops an outage at Google from killing the funnel.
 */
export async function getSlotsForDate(dateStr: string): Promise<TimeSlot[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return [];

  const availableDays = (process.env.AVAILABLE_DAYS ?? '1,2,3,4,5,6')
    .split(',')
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => Number.isInteger(d));

  // Day of week for that date, in the booking timezone.
  const dayStart = localToUtc(`${dateStr}T12:00:00`);
  const { weekday } = toLocalParts(dayStart);
  if (!availableDays.includes(weekday)) return [];

  let slots = generateSlots(dateStr);
  if (slots.length === 0) return [];

  // --- 1. Drop anything in the past or inside the notice window -------------
  const cutoff = Date.now() + MIN_NOTICE_MINUTES * 60_000;
  slots = slots.filter((s) => localToUtc(s.startIso).getTime() >= cutoff);
  if (slots.length === 0) return [];

  // --- 2. Subtract Google Calendar busy time -------------------------------
  const windowStart = localToUtc(`${dateStr}T00:00:00`);
  const windowEnd = localToUtc(addMinutesLocal(`${dateStr}T00:00:00`, 24 * 60));

  if (isGoogleConfigured()) {
    try {
      const busy = await getBusyIntervals(
        windowStart.toISOString(),
        windowEnd.toISOString()
      );

      slots = slots.filter((slot) => {
        const start = localToUtc(slot.startIso).getTime();
        const end = localToUtc(slot.endIso).getTime();
        return !busy.some((b) => {
          const bStart = new Date(b.start).getTime();
          const bEnd = new Date(b.end).getTime();
          return start < bEnd && end > bStart; // overlap
        });
      });
    } catch (err) {
      console.error('[availability] Google free/busy lookup failed:', err);
      // Degrade open — see the note on this function.
    }
  }

  // --- 3. Subtract slots already held in Supabase --------------------------
  try {
    const taken = new Set(
      await getBookedSlotStarts(windowStart.toISOString(), windowEnd.toISOString())
    );
    if (taken.size > 0) {
      slots = slots.filter(
        (slot) => !taken.has(localToUtc(slot.startIso).toISOString())
      );
    }
  } catch (err) {
    console.error('[availability] Supabase booked-slot lookup failed:', err);
  }

  return slots;
}

/** The slot matching a "HH:MM" value, or null if it is not bookable. */
export async function findSlot(dateStr: string, time: string): Promise<TimeSlot | null> {
  const slots = await getSlotsForDate(dateStr);
  return slots.find((s) => s.value === time) ?? null;
}

export async function isDateAvailable(dateStr: string): Promise<boolean> {
  return (await getSlotsForDate(dateStr)).length > 0;
}

export { TIMEZONE };
