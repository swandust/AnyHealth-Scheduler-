import { NextRequest, NextResponse } from 'next/server';
import { getSlotsForDate } from '@/lib/availability';
import {validBookingDate} from '@/lib/serverConfig';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');

  if (!date || !validBookingDate(date)) {
    return NextResponse.json({ error: 'Invalid date. Use YYYY-MM-DD format.' }, { status: 400 });
  }

  // Don't allow dates in the past (SGT)
  const nowSgt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayStr = [
    nowSgt.getUTCFullYear(),
    String(nowSgt.getUTCMonth() + 1).padStart(2, '0'),
    String(nowSgt.getUTCDate()).padStart(2, '0'),
  ].join('-');

  if (date < todayStr) {
    return NextResponse.json({ slots: [] });
  }

  try {
    const slots = await getSlotsForDate(date);
    return NextResponse.json({ slots }, {headers:{'Cache-Control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Availability could not be checked. Please try again or email contact@anyhealth.asia.'}, {status:503,headers:{'Cache-Control':'no-store'}});
  }
}
