import { NextResponse, type NextRequest } from 'next/server';
import { checkEmail } from '@/lib/emailVerify';

/**
 * Called by the wizard when the contact step's email field loses focus, and
 * again before the step advances. Deliberately cheap: syntax, MX and a
 * disposable-domain list, all in-process. No third-party API, no key.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim();
  if (!email) {
    return NextResponse.json({ valid: false, verdict: 'invalid_syntax', flags: [] });
  }

  const result = await checkEmail(email);

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
