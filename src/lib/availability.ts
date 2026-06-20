import { graphRequest } from './graphClient';

const DURATION_MINUTES = 30;
const MAILBOX = process.env.CALENDAR_USER_EMAIL!;

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
  endIso: string;     // "2026-07-10T08:30:00"
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLabel(h: number, m: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = h % 12 || 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

export async function getSlotsForDate(dateStr: string): Promise<TimeSlot[]> {
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
      // Handle midnight overflow (e.g., 23:30 + 30min = 24:00 → next day T00:00)
      let endIso: string;
      if (endH >= 24) {
        const nextDay = new Date(Date.UTC(y, mo - 1, d + 1));
        const ndStr = `${nextDay.getUTCFullYear()}-${pad(nextDay.getUTCMonth() + 1)}-${pad(nextDay.getUTCDate())}`;
        endIso = `${ndStr}T${pad(endH - 24)}:${pad(endM)}:00`;
      } else {
        endIso = `${dateStr}T${pad(endH)}:${pad(endM)}:00`;
      }

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

  let futureSlots = slots;
  if (dateStr === todayStrSgt) {
    const nowH = nowSgt.getUTCHours();
    const nowM = nowSgt.getUTCMinutes();
    futureSlots = slots.filter(
      (s) => {
        const [slotH, slotM] = s.value.split(':').map(Number);
        return slotH > nowH || (slotH === nowH && slotM > nowM);
      }
    );
  } else if (dateStr < todayStrSgt) {
    return [];
  }

  // If no slots left in the future, return early
  if (futureSlots.length === 0) return [];

  // --- Fetch Outlook Calendar Events to filter out Busy slots ---
  try {
    // SGT is UTC+8
    const startUtc = new Date(Date.UTC(y, mo - 1, d, -8, 0, 0)).toISOString();
    const endUtc = new Date(Date.UTC(y, mo - 1, d, 16, 0, 0)).toISOString(); // 24-8 = 16 (next midnight UTC)

    // Using calendarView which automatically handles recurring events
    const query = `?startDateTime=${startUtc}&endDateTime=${endUtc}&$select=start,end,showAs`;
    const res = await graphRequest<any>('GET', `/users/${MAILBOX}/calendarView${query}`);
    
    if (res && res.value) {
      const busyEvents = res.value.filter((ev: any) => 
        ev.showAs === 'busy' || ev.showAs === 'tentative' || ev.showAs === 'oof'
      );

      // Filter futureSlots against busyEvents
      futureSlots = futureSlots.filter((slot) => {
        const slotStart = new Date(slot.startIso + '+08:00').getTime();
        const slotEnd = new Date(slot.endIso + '+08:00').getTime();

        const isOverlapping = busyEvents.some((ev: any) => {
          const evStart = new Date(ev.start.dateTime + 'Z').getTime();
          const evEnd = new Date(ev.end.dateTime + 'Z').getTime();
          // overlap condition: SlotStart < EvEnd AND SlotEnd > EvStart
          return slotStart < evEnd && slotEnd > evStart;
        });

        return !isOverlapping; // keep slot if NO overlap
      });
    }
  } catch (err) {
    console.error('Failed to fetch calendar for availability:', err);
    // If it fails, we fall back to showing all future slots to not block bookings,
    // though realistically we'd want to handle this better in a production app.
  }

  return futureSlots;
}

export async function isDateAvailable(dateStr: string): Promise<boolean> {
  const slots = await getSlotsForDate(dateStr);
  return slots.length > 0;
}
