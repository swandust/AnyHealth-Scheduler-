import { TIMEZONE, localToUtc, toIcsStamp } from './time';

/**
 * Minimal RFC 5545 generator for the booking confirmation attachment.
 *
 * The previous version pasted values straight into the file, so any comma or
 * semicolon in a value — and the challenge list is comma-joined — produced an
 * invite that Apple Calendar quietly refused to import. Values now go through
 * `escapeText`, and long lines are folded at 75 octets as the spec requires.
 */

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold to 75 octets per line, continuation lines prefixed with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back off to a lead byte.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }

  return chunks.join('\r\n ');
}

export interface IcsParams {
  uid: string;
  summary: string;
  description: string;
  location: string;
  /** Local wall-clock, "YYYY-MM-DDTHH:MM:SS". */
  startLocal: string;
  endLocal: string;
  organizerEmail: string;
  organizerName?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  url?: string;
  /** Bump when re-sending an amended invite for the same UID. */
  sequence?: number;
  method?: 'REQUEST' | 'CANCEL';
  status?: 'CONFIRMED' | 'CANCELLED';
}

export function buildIcs(p: IcsParams): string {
  const start = localToUtc(p.startLocal, TIMEZONE);
  const end = localToUtc(p.endLocal, TIMEZONE);

  const lines: Array<string | null> = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AnyHealth//Booking System//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${p.method ?? 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${escapeText(p.uid)}`,
    `DTSTAMP:${toIcsStamp(new Date())}`,
    `DTSTART:${toIcsStamp(start)}`,
    `DTEND:${toIcsStamp(end)}`,
    `SUMMARY:${escapeText(p.summary)}`,
    `DESCRIPTION:${escapeText(p.description)}`,
    `LOCATION:${escapeText(p.location)}`,
    p.url ? `URL:${escapeText(p.url)}` : null,
    `ORGANIZER;CN=${escapeText(p.organizerName ?? 'AnyHealth')}:mailto:${p.organizerEmail}`,
    p.attendeeEmail
      ? `ATTENDEE;CN=${escapeText(p.attendeeName ?? p.attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${p.attendeeEmail}`
      : null,
    `STATUS:${p.status ?? 'CONFIRMED'}`,
    `SEQUENCE:${p.sequence ?? 0}`,
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Upcoming AnyHealth appointment',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.filter((l): l is string => l !== null).map(fold).join('\r\n');
}
