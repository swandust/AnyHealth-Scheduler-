/**
 * Shared Google OAuth token handling.
 *
 * One refresh token, belonging to the AnyHealth Google account, covers both
 * Calendar (the event + Meet link) and Gmail (the confirmation emails). That is
 * the main reason to send through Gmail rather than SMTP: there is a single
 * credential to keep alive instead of two, and no mail password at all.
 *
 * Mint it with `npm run google:auth`.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Scopes the auth script asks for. Keep in step with scripts/google-auth.mjs. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
  );
}

let _token: { value: string; expiresAt: number; scope: string } | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.value;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google is not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ' +
        'GOOGLE_REFRESH_TOKEN (run `npm run google:auth`).'
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google OAuth refresh failed (${res.status} ${data.error ?? ''}): ` +
        `${data.error_description ?? 'no access_token returned'}` +
        (data.error === 'invalid_grant'
          ? ' — re-run `npm run google:auth`, and make sure the OAuth consent ' +
            'screen is set to "In production", not "Testing".'
          : '')
    );
  }

  _token = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? '',
  };
  return _token.value;
}

/**
 * Scopes the current refresh token actually carries. After adding a scope you
 * must re-run `npm run google:auth` — an existing token is never upgraded, and
 * the call just starts failing with 403 insufficient permissions.
 */
export async function getGrantedScopes(): Promise<string[]> {
  await getGoogleAccessToken();
  return (_token?.scope ?? '').split(' ').filter(Boolean);
}

export async function hasScope(scope: string): Promise<boolean> {
  return (await getGrantedScopes()).includes(scope);
}
