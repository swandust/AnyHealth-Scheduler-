import { NextResponse, type NextRequest } from 'next/server';
import { adminTokenConfigured, isAuthorised } from '@/lib/adminAuth';
import { getGoogleAccessToken, isGoogleConfigured } from '@/lib/googleCalendar';
import { isMailerConfigured, verifyMailer } from '@/lib/mailer';
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
      checks.google = { configured: true, ok: true, detail: 'refresh token still valid' };
    } catch (err) {
      checks.google = {
        configured: true,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Zoho SMTP
  if (!isMailerConfigured()) {
    checks.zohoMail = { configured: false, ok: false, detail: 'ZOHO_SMTP_USER / ZOHO_SMTP_PASSWORD missing' };
  } else {
    const result = await verifyMailer();
    checks.zohoMail = { configured: true, ok: result.ok, detail: result.error ?? 'SMTP login accepted' };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { ok: allOk, checkedAt: new Date().toISOString(), checks },
    { status: allOk ? 200 : 500, headers: { 'Cache-Control': 'no-store' } }
  );
}
