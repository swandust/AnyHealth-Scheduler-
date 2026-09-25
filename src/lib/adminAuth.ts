import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Shared-secret gate for the /admin screens.
 *
 * Deliberately simple: this protects an internal list, not patient records at
 * scale. If more than a couple of people need access, put Supabase Auth in
 * front of it instead of handing the token around.
 */
export function adminTokenConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length >= 16);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isAuthorised(req: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 16) return false;

  const header = req.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const supplied =
    bearer ||
    req.nextUrl.searchParams.get('token') ||
    req.cookies.get('anyhealth_admin')?.value ||
    '';

  return Boolean(supplied) && safeEqual(supplied, expected);
}
