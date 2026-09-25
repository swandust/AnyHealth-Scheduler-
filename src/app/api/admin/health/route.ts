import { NextResponse, type NextRequest } from 'next/server';
import { adminTokenConfigured, isAuthorised } from '@/lib/adminAuth';
import { getGoogleAccessToken, getGrantedScopes, isGoogleConfigured } from '@/lib/googleAuth';
import { activeTransport, verifyMailer } from '@/lib/mailer';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * One call that says whether each integration is actually working.
 *
 * Hit this after every deploy and after any credential rotation. The old setup
 * failed silently for weeks because nothing ever asked "is mail still working?"
 * — this is that question.
 */
export async function GET(req: NextRequest) {
  if (!adminTokenConfigured() || !isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const checks: Record<string, { configured: boolean; ok: boolean; detail?: string }> = {};

  // Supabase
  if (!isSupabaseConfigured()) {
    checks.supabase = { configured: false, ok: false, detail: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' };
  } else {
    try {
      const db = getSupabase()!;
      const { error, count } = await db
        .from('bookings')
        .select('id', { count: 'exact', head: true });
      checks.supabase = error
        ? { configured: true, ok: false, detail: error.message }
        : { configured: true, ok: true, detail: `${count ?? 0} bookings stored` };
    } catch (err) {
      checks.supabase = { configured: true, ok: false, detail: String(err) };
    }
  }

  // Google Calendar / Meet
  if (!isGoogleConfigured()) {
    checks.google = { configured: false, ok: false, detail: 'GOOGLE_CLIENT_ID / _SECRET / _REFRESH_TOKEN missing' };
  } else {
    try {
      await getGoogleAccessToken();
      const scopes = await getGrantedScopes();
      const missing = [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.send',
      ].filter((s) => !scopes.includes(s));

      checks.google = missing.length
        ? {
            configured: true,
            ok: false,
            detail:
              `refresh token is valid but missing scope(s): ${missing.join(', ')} — ` +
              're-run `npm run google:auth`',
          }
        : { configured: true, ok: true, detail: 'refresh token valid, all scopes granted' };
    } catch (err) {
      checks.google = {
        configured: true,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Mail — Gmail API or SMTP, whichever is active
  const transport = activeTransport();
  if (transport === 'none') {
    checks.mail = {
      configured: false,
      ok: false,
      detail: 'No transport: configure Google (preferred) or SMTP_USER / SMTP_PASSWORD',
    };
  } else {
    const result = await verifyMailer();
    checks.mail = {
      configured: true,
      ok: result.ok,
      // A warning can ride along with ok:true — e.g. a From address that Gmail
      // will rewrite. Surface it rather than hiding it behind a green tick.
      detail: result.error ?? `${transport} transport ready`,
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { ok: allOk, checkedAt: new Date().toISOString(), checks },
    { status: allOk ? 200 : 500, headers: { 'Cache-Control': 'no-store' } }
  );
}
