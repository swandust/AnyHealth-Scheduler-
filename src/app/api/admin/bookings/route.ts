import { NextResponse, type NextRequest } from 'next/server';
import { adminTokenConfigured, isAuthorised } from '@/lib/adminAuth';
import { isSupabaseConfigured, listBookings, type BookingStatus } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  if (!adminTokenConfigured()) {
    return NextResponse.json(
      { error: 'ADMIN_TOKEN is not set (must be at least 16 characters).' },
      { status: 503 }
    );
  }
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
  }

  const q = req.nextUrl.searchParams;
  const limit = Math.min(Number(q.get('limit') ?? 200) || 200, 1000);
  const status = q.get('status') as BookingStatus | null;

  const bookings = await listBookings({
    limit,
    status: status ?? undefined,
    from: q.get('from') ?? undefined,
  });

  const response = NextResponse.json({ count: bookings.length, bookings });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
