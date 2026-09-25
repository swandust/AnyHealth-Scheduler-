# AnyHealth Scheduler — Setup

Everything runs on three services now. Microsoft 365, Outlook and Zoom are gone.

| What | Service | Why |
|---|---|---|
| Storing the answers | **Supabase** | The booking is written here *first*, before anything else runs, so it can never be lost again |
| Meeting link + calendar | **Google Calendar API** | One call creates the calendar event *and* the Google Meet link, and emails the invite |
| Confirmation emails | **Zoho Mail** (SMTP) | Branded confirmation to the client, notification to you |

Budget about 30 minutes. Do the steps in order — Step 1 has to exist before anything will save.

---

## Step 1 — Supabase

### 1.1 Create the project

1. Go to **[supabase.com/dashboard](https://supabase.com/dashboard)** → **New project**.
2. Name it `anyhealth-scheduler`, pick the **Singapore (ap-southeast-1)** region, set a database password (save it in your password manager — you won't need it for this app).
3. Wait for provisioning (~2 min).

### 1.2 Create the tables

1. Open **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. You should see `Success. No rows returned`. Under **Table Editor** you now have `bookings` and `booking_events`.

The script is safe to re-run — every statement is `if not exists` / `or replace`.

### 1.3 Copy the keys

**Project Settings** → **API**:

| Dashboard field | Environment variable |
|---|---|
| Project URL | `SUPABASE_URL` |
| `service_role` secret | `SUPABASE_SERVICE_ROLE_KEY` |

> [!CAUTION]
> The `service_role` key bypasses every security rule. It is only ever read by server-side code in this repo. Never put it in a client component, never commit it, never paste it into a browser console.

Row Level Security is switched on for both tables and **no public policy is created**, so even if the `anon` key leaks, nobody can read a single booking.

---

## Step 2 — Google (Calendar + Meet)

You need one Google account — the one that should own the meetings and appear as host. A free `@gmail.com` account works; you do **not** need Google Workspace.

### 2.1 Create a Google Cloud project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**, signed in as that account.
2. Top bar → project dropdown → **New Project** → name it `AnyHealth Scheduler` → **Create**.

### 2.2 Turn on the Calendar API

1. **APIs & Services** → **Library**.
2. Search **Google Calendar API** → **Enable**.

### 2.3 Configure the consent screen

1. **APIs & Services** → **OAuth consent screen**.
2. User type: **External** → **Create**.
3. App name `AnyHealth Scheduler`, support email and developer email: your own address → **Save and continue**.
4. Scopes: skip (the script asks for them at sign-in time) → **Save and continue**.
5. Test users: add the Google account itself → **Save and continue**.
6. Back on the summary page, click **Publish app** → **Confirm**.

> [!IMPORTANT]
> Step 6 is not optional. While the consent screen says **Testing**, Google expires the refresh token after **7 days** and the scheduler silently stops creating meetings — exactly the kind of quiet failure that lost your history last time. Publishing status must read **In production**.
>
> You will see an "unverified app" warning when you sign in. That is expected and fine: verification is only needed for apps used by people outside your own account. Click **Advanced** → **Go to AnyHealth Scheduler (unsafe)**.

### 2.4 Create the OAuth client

1. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
2. Application type: **Web application**, name `AnyHealth Scheduler`.
3. Under **Authorised redirect URIs**, add exactly:
   ```
   http://localhost:5555/oauth2callback
   ```
4. **Create**, then copy:
   - Client ID → `GOOGLE_CLIENT_ID`
   - Client secret → `GOOGLE_CLIENT_SECRET`

### 2.5 Mint the refresh token

Put the client ID and secret in `.env.local` first, then:

```bash
npm run google:auth
```

It prints a URL. Open it, sign in as the AnyHealth Google account, approve, and the terminal prints:

```
GOOGLE_REFRESH_TOKEN=1//0g...
```

Paste that into `.env.local` **and** into Vercel. Set `GOOGLE_CALENDAR_ID=primary` unless the meetings belong on a secondary calendar, in which case use that calendar's ID from Google Calendar → Settings → *calendar name* → **Integrate calendar**.

> If the script says Google returned no refresh token, revoke the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and run it again.

---

## Step 3 — Zoho Mail

### 3.1 Check your plan can use SMTP

Zoho's **Forever Free** plan is webmail only — IMAP/POP/SMTP are not included, so this step will fail on it. Either:

- upgrade to **Mail Lite** (about USD 1/user/month), or
- use **[ZeptoMail](https://www.zoho.com/zeptomail/)**, Zoho's transactional mail service (free trial credits, then pay-as-you-go). It is actually the better fit for automated mail, and it deliberately separates transactional sending from your inbox.

Both are plain SMTP, so switching between them is an environment variable change, not a code change.

### 3.2 Verify the domain

If `anyhealth.asia` is not already sending through Zoho: **Zoho Mail Admin Console** → **Domains** → add `anyhealth.asia`, then add the **SPF**, **DKIM** and **DMARC** records it gives you at your DNS host. Wait for all three to verify.

Without SPF and DKIM your confirmations land in spam — which looks identical to "the email isn't working".

### 3.3 Create an app-specific password

1. **[accounts.zoho.com](https://accounts.zoho.com)** → **Security** → **App Passwords**.
2. **Generate New Password**, name it `AnyHealth Scheduler`.
3. Copy it → `ZOHO_SMTP_PASSWORD`. It is shown once.

Use your full email address as `ZOHO_SMTP_USER`. Do **not** use your normal login password — it will fail outright if two-factor authentication is on.

### 3.4 Pick the right host

| Where your Zoho account lives | `ZOHO_SMTP_HOST` |
|---|---|
| Global / `.com` | `smtp.zoho.com` |
| Europe | `smtp.zoho.eu` |
| India | `smtp.zoho.in` |
| Australia | `smtp.zoho.com.au` |
| ZeptoMail | `smtp.zeptomail.com` |

Port `465` with `ZOHO_SMTP_SECURE=true`, or port `587` with `ZOHO_SMTP_SECURE=false` if 465 is blocked.

---

## Step 4 — Environment variables

```bash
cp .env.example .env.local
```

Fill in every value. Generate the admin token with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

---

## Step 5 — Run it

```bash
npm install
npm run dev
```

Then, in order:

1. Open <http://localhost:3000/api/admin/health?token=YOUR_ADMIN_TOKEN>.
   All three checks should read `"ok": true`. Fix anything that doesn't **before** taking a real booking — this endpoint is the whole point, it tells you the integrations work instead of you finding out from a customer.
2. Book a test consultation at <http://localhost:3000/book> using your own email.
3. Check: the row appears at <http://localhost:3000/admin>, the event is in Google Calendar with a Meet link, and both emails arrive.

---

## Step 6 — Deploy

1. Push the branch and import the repo at **[vercel.com](https://vercel.com)** → **New Project**.
2. Add every variable from `.env.local` under **Environment Variables**.
3. Deploy, then set `NEXT_PUBLIC_BASE_URL` to the real URL and redeploy.
4. Open `/api/admin/health?token=…` on the deployed URL and confirm all three are green.

---

## Recovering the history you lost

The old app wrote nothing to a database. A booking existed only as a Zoom meeting, an Outlook event and two emails — so when mail broke, there was nothing left to look at. Two traces can still be pulled back into Supabase.

### From the old Zoom account

Zoom kept every meeting it created, and each topic was `AnyHealth Initial Consultation – {name}`. Put the old `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` back in `.env.local`, then:

```bash
npm run recover -- --zoom --dry-run    # look first
npm run recover -- --zoom              # then write
```

This gives you **name, date and time** for every booking the old system created. Zoom never stored the email address, role or challenges, so those stay blank — but you get the list of who you owe a reply to.

### From the old Outlook calendar

If you can still open the mailbox, this is the richer source: the event body held name, email, goal and challenges.

1. Outlook → **Calendar** → **Add calendar** → **Export** (or File → Save Calendar) → save as `.ics`.
2. Then:

```bash
npm run recover -- --ics ./export.ics --dry-run
npm run recover -- --ics ./export.ics
```

Recovered rows are tagged `zoom-backfill` / `ics-backfill` in the `source` column so they never get confused with live bookings. Re-running is safe; existing rows are skipped.

Realistically, Vercel's function logs are the only other trace and they are long expired. If a booking never reached Zoom either, it left no record anywhere — that gap is unrecoverable.

---

## Why this cannot happen silently again

- **The booking is saved before anything else runs.** Google and Zoho are called *after* the Supabase insert, so a failure in either leaves a complete record with the answers intact.
- **Every step records its outcome.** `calendar_status`, `client_email_status` and `practitioner_email_status` on each row, plus an append-only `booking_events` log. A failed email is a red pill on `/admin`, not silence.
- **If Supabase itself is unreachable**, the booking still goes through and you get an `[ACTION NEEDED]` email containing the full payload, so there is always at least one copy.
- **If Google fails**, the customer is told honestly, the row is kept with the error text, and you get an alert with their details so you can follow up by hand.
- **`/api/admin/health`** answers "is it all still working?" on demand. Check it after every deploy and after any password or key change.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Health check: `google` fails with `invalid_grant` | Refresh token revoked, or the OAuth consent screen is still **Testing** (7-day expiry). Set it to **In production**, then `npm run google:auth`. |
| Event created but no Meet link | The Calendar API call must include `conferenceDataVersion=1` — it does. If it persists, the Google account is blocked from creating Meet conferences (some Workspace policies); use a personal Google account. |
| Health check: `zohoMail` fails with `535 Authentication Failed` | Using the login password instead of an app-specific password, or the wrong regional host. |
| Zoho connects locally, times out on Vercel | Port 465 blocked. Set `ZOHO_SMTP_PORT=587` and `ZOHO_SMTP_SECURE=false`. |
| Emails arrive in spam | SPF/DKIM/DMARC not verified for `anyhealth.asia`, or `FROM_EMAIL` isn't the authenticated Zoho account or one of its verified aliases. |
| Health check: `supabase` fails with `relation "bookings" does not exist` | `supabase/schema.sql` was never run. |
| `409` when booking | The slot went in the meantime. Genuine — the unique index on `start_utc` is what stops double-booking. |
| `/admin` returns 401 | `ADMIN_TOKEN` missing, under 16 characters, or not matching. |
| No slots show for any date | Check `AVAILABLE_DAYS`, and that `MIN_NOTICE_MINUTES` isn't swallowing the day. |

---

## Security notes

- Every credential is read server-side only; none is exposed to the browser.
- RLS is on with no public policies, so the `anon` key grants nothing.
- Client-supplied text is HTML-escaped before it goes into an email, and escaped per RFC 5545 before it goes into a calendar invite.
- `/admin` is a shared-secret gate. That is proportionate for an internal list — if more than a couple of people need it, put Supabase Auth in front instead of passing the token around.
- Still worth adding before high traffic: rate limiting on `/api/book` (e.g. `@upstash/ratelimit`) and a CAPTCHA if bots start filling slots.
