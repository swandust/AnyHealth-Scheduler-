import { NextRequest, NextResponse } from 'next/server';
import { createOutlookEvent } from '@/lib/calendarService';
import { createZoomMeeting } from '@/lib/zoomService';
import { sendClientConfirmation, sendPractitionerNotification } from '@/lib/emailService';
import { getSlotsForDate } from '@/lib/availability';

function generateBookingId(): string {
  return `AH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function POST(req: NextRequest) {
  let body: {
    clientName?: string;
    clientEmail?: string;
    clientPhone?: string;
    goal?: string;
    challenges?: string[];
    date?: string;         // "YYYY-MM-DD"
    timeValue?: string;    // "08:00"
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { clientName, clientEmail, clientPhone, goal, challenges, date, time } = body as any;

  // --- Validation ---
  if (!clientName?.trim())   return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
  if (!clientEmail?.trim())  return NextResponse.json({ error: 'Client email is required' }, { status: 400 });
  if (!goal?.trim())         return NextResponse.json({ error: 'Goal is required' }, { status: 400 });
  if (!date || !time)        return NextResponse.json({ error: 'Date and time are required' }, { status: 400 });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clientEmail)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  // --- Confirm slot is still available ---
  const slots = getSlotsForDate(date);
  const slot  = slots.find((s) => s.value === time);
  if (!slot) {
    return NextResponse.json({ error: 'Selected time slot is no longer available. Please choose another.' }, { status: 409 });
  }

  const bookingId = generateBookingId();

  try {
    // 1. Create Zoom meeting
    // Convert SGT local ISO to UTC ISO for Zoom API
    const [sgtDatePart, sgtTimePart] = slot.startIso.split('T');
    const [y, mo, d] = sgtDatePart.split('-').map(Number);
    const [h, mi]    = sgtTimePart.split(':').map(Number);
    const utcStart   = new Date(Date.UTC(y, mo - 1, d, h - 8, mi)); // SGT is UTC+8

    const zoomMeeting = await createZoomMeeting({
      topic: `AnyHealth Initial Consultation – ${clientName}`,
      startIso: utcStart.toISOString(),
      durationMinutes: 30,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
    });

    const bookingParams = {
      bookingId,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      clientPhone: clientPhone.trim(),
      goal: goal.trim(),
      challenges: challenges ?? [],
      startIso: slot.startIso,
      endIso: slot.endIso,
      zoomJoinUrl: zoomMeeting.join_url,
      zoomMeetingId: zoomMeeting.id,
      zoomPassword: zoomMeeting.password,
    };

    // 2. Create Outlook calendar event (fire and continue even if this fails)
    try {
      await createOutlookEvent({
        clientName: bookingParams.clientName,
        clientEmail: bookingParams.clientEmail,
        goal: bookingParams.goal,
        challenges: bookingParams.challenges,
        startIso: bookingParams.startIso,
        endIso: bookingParams.endIso,
        zoomJoinUrl: zoomMeeting.join_url,
        zoomMeetingId: String(zoomMeeting.id),
      });
    } catch (calErr) {
      // Log but don't fail the booking — email will still be sent
      console.error('[Booking] Outlook calendar error (non-fatal):', calErr);
    }

    // 3. Send emails in parallel
    await Promise.all([
      sendClientConfirmation(bookingParams),
      sendPractitionerNotification(bookingParams),
    ]);

    return NextResponse.json({
      success: true,
      bookingId,
      zoomJoinUrl: zoomMeeting.join_url,
      zoomMeetingId: zoomMeeting.id,
      zoomPassword: zoomMeeting.password,
      startIso: slot.startIso,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Booking] Fatal error:', message);
    return NextResponse.json(
      { error: 'Booking failed. Please try again or contact us directly at contact@anyhealth.asia', detail: message },
      { status: 500 }
    );
  }
}
