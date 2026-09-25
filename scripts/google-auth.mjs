#!/usr/bin/env node
/**
 * One-time Google OAuth helper.
 *
 *   npm run google:auth
 *
 * Opens a consent screen for the AnyHealth Google account, then prints the
 * refresh token to paste into GOOGLE_REFRESH_TOKEN. Run it again whenever the
 * token is revoked (changed password, removed app access, or an OAuth consent
 * screen still stuck in "Testing" mode, where tokens expire after 7 days).
 */

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.OAUTH_PORT ?? 5555);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',  // create the event + Meet link
  'https://www.googleapis.com/auth/calendar.readonly', // free/busy lookup
];

/* ─── Read credentials from .env.local, .env, or the environment ─────────── */

function loadEnvFile(name) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = { ...loadEnvFile('.env'), ...loadEnvFile('.env.local') };
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || fileEnv.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || fileEnv.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.

Create them first:
  1. console.cloud.google.com  →  APIs & Services  →  Credentials
  2. Create Credentials  →  OAuth client ID  →  Web application
  3. Add this Authorised redirect URI:  ${REDIRECT_URI}
  4. Put the client ID and secret in .env.local, then run this again.
`);
  process.exit(1);
}

/* ─── Build the consent URL ──────────────────────────────────────────────── */

const state = createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 24);

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',   // this is what makes Google issue a refresh token
    prompt: 'consent',        // force a fresh refresh token even if already granted
    include_granted_scopes: 'true',
    state,
  });

console.log(`
──────────────────────────────────────────────────────────────────────
  Open this URL and sign in as the AnyHealth Google account:

${authUrl}

  Waiting for the redirect on ${REDIRECT_URI} …
──────────────────────────────────────────────────────────────────────
`);

/* ─── Catch the redirect and swap the code for tokens ────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end('Not found');
    return;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
       .end(`<h1>Authorisation failed</h1><p>${error ?? 'no code returned'}</p>`);
    console.error(`\nAuthorisation failed: ${error ?? 'no code returned'}`);
    server.close();
    process.exit(1);
  }

  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('State mismatch');
    console.error('\nState mismatch — start again.');
    server.close();
    process.exit(1);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.refresh_token) {
    res.writeHead(500, { 'Content-Type': 'text/html' })
       .end('<h1>Token exchange failed</h1><p>Check the terminal.</p>');
    console.error('\nToken exchange failed:', JSON.stringify(tokens, null, 2));
    if (tokenRes.ok && !tokens.refresh_token) {
      console.error(
        '\nGoogle returned an access token but no refresh token. That happens when the ' +
        'account already granted this client. Revoke it at ' +
        'https://myaccount.google.com/permissions and run this again.'
      );
    }
    server.close();
    process.exit(1);
  }

  // Which account did we actually authorise? Easy thing to get wrong.
  let account = 'unknown';
  try {
    const whoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (whoRes.ok) account = (await whoRes.json()).email ?? 'unknown';
  } catch { /* best effort */ }

  res.writeHead(200, { 'Content-Type': 'text/html' }).end(
    `<body style="font-family:system-ui;padding:48px;max-width:600px;margin:0 auto">
       <h1 style="color:#006c4e">Done</h1>
       <p>Authorised <strong>${account}</strong>. Copy the refresh token from your terminal
          into <code>GOOGLE_REFRESH_TOKEN</code>, then close this tab.</p>
     </body>`
  );

  console.log(`
──────────────────────────────────────────────────────────────────────
  Authorised account: ${account}

  Add this to .env.local AND to your Vercel environment variables:

GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}

  Granted scopes: ${tokens.scope}

  IMPORTANT: in Google Cloud Console → APIs & Services → OAuth consent
  screen, set Publishing status to "In production". While it says
  "Testing", this refresh token stops working after 7 days.
──────────────────────────────────────────────────────────────────────
`);

  server.close();
  process.exit(0);
});

server.listen(PORT);
