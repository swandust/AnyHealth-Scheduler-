import { NextResponse } from 'next/server';
import { isChallengeEnabled, issueChallenge } from '@/lib/security';

/**
 * Issues the signed token the wizard sends back with the booking.
 *
 * A bot POSTing directly at /api/book never calls this, so it has no token —
 * and cannot mint one without the server secret. The token also carries its
 * own issue time, signed, which is how dwell time is measured without
 * trusting a timestamp from the client.
 */
export async function GET() {
  const token = issueChallenge();

  return NextResponse.json(
    { token, enabled: isChallengeEnabled() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
