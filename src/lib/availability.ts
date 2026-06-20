/**
 * Availability logic for AnyHealth bookings.
 *
 * Config (from .env.local):
 *   AVAILABLE_DAYS   = "1,2,3,4,5,6"   (1=Mon … 6=Sat, 0=Sun)
 *
 * Fixed time blocks (Asia/Singapore, UTC+8):
 *   Morning   : 08:00 – 11:45  (slots: 08:00, 08:45, 09:30, 10:15, 11:00)
 *   Afternoon : 14:00 – 17:45  (slots: 14:00, 14:45, 15:30, 16:15, 17:00)
 *   Evening   : 21:00 – 23:59  (slots: 21:00, 21:45, 22:30, 23:15)
 *
 * Each slot is 45 minutes. Slots that would end AFTER the block window are excluded.
 */

const DURATION_MINUTES = 45;

// [startHour, startMinute, endHour (exclusive for new starts)]
const BLOCKS: [number, number, number, number][] = [
  [8,  0, 12, 0],  // Morning   08:00 – before 12:00
  [14, 0, 18, 0],  // Afternoon 14:00 – before 18:00
  [21, 0, 24, 0],  // Evening   21:00 – before 24:00
];

export interface TimeSlot {
  label: string;      // "8:00 AM"
  value: string;      // "08:00"
  startIso: string;   // "2026-07-10T08:00:00"
  endIso: string;     // "2026-07-10T08:45:00"
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLabel(h: number, m: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = h % 12 || 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

export function getSlotsForDate(dateStr: string): TimeSlot[] {
  // dateStr: "YYYY-MM-DD" in SGT
  const availableDays = (process.env.AVAILABLE_DAYS ?? '1,2,3,4,5,6')
    .split(',')
    .map((d) => parseInt(d.trim(), 10));

  // Determine day-of-week in SGT (UTC+8)
  const [y, mo, d] = dateStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)); // midnight UTC
  const sgtMs   = utcDate.getTime() + 8 * 60 * 60 * 1000;    // shift to SGT
  const sgtDate = new Date(sgtMs);
  const dow     = sgtDate.getUTCDay(); // 0=Sun 1=Mon … 6=Sat

  if (!availableDays.includes(dow)) return [];

  const slots: TimeSlot[] = [];

  for (const [bStartH, bStartM, bEndH, bEndM] of BLOCKS) {
    let curH = bStartH;
    let curM = bStartM;

    while (true) {
      // Calculate end of this slot
      const endTotalMins = curH * 60 + curM + DURATION_MINUTES;
      const endH = Math.floor(endTotalMins / 60);
      const endM = endTotalMins % 60;

      // Stop if end exceeds block boundary
      if (endH > bEndH || (endH === bEndH && endM > bEndM)) break;

      const startIso = `${dateStr}T${pad(curH)}:${pad(curM)}:00`;
      const endIso   = `${dateStr}T${pad(endH)}:${pad(endM)}:00`;

      slots.push({
        label: toLabel(curH, curM),
        value: `${pad(curH)}:${pad(curM)}`,
        startIso,
        endIso,
      });

      // Next slot
      curH = endH;
      curM = endM;
    }
  }

  // Filter out past slots (compare against current SGT time)
  const nowSgt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayStrSgt = [
    nowSgt.getUTCFullYear(),
    pad(nowSgt.getUTCMonth() + 1),
    pad(nowSgt.getUTCDate()),
  ].join('-');

  if (dateStr === todayStrSgt) {
    const nowH = nowSgt.getUTCHours();
    const nowM = nowSgt.getUTCMinutes();
    return slots.filter(
      (s) => {
        const [slotH, slotM] = s.value.split(':').map(Number);
        return slotH > nowH || (slotH === nowH && slotM > nowM);
      }
    );
  }

  return slots;
}

export function isDateAvailable(dateStr: string): boolean {
  return getSlotsForDate(dateStr).length > 0;
}
