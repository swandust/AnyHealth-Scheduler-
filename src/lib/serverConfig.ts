/** Scheduler storage is independent of website sign-in. Never expose these values. */
export function schedulerDatabaseSettings() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('Scheduler database credentials are missing.');
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid scheduler database URL.');
  // Legacy service-role JWTs identify their project. New opaque secret keys do not.
  if (key.startsWith('eyJ')) {
    let claims: {ref?:string;role?:string};
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('Invalid scheduler database credential format.'); }
    if (claims.role !== 'service_role') throw new Error('Scheduler requires a server-side service-role credential.');
    if (parsed.hostname.endsWith('.supabase.co') && claims.ref !== parsed.hostname.split('.')[0]) {
      throw new Error('Scheduler database URL and service-role key belong to different projects.');
    }
  }
  return {url,key};
}

export function validBookingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
