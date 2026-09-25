# AnyHealth Scheduler — Setup

Everything runs on two accounts now — Supabase and one Google account. Microsoft 365, Outlook and Zoom are gone.

| What | Service | Why |
|---|---|---|
| Storing the answers | **Supabase** | The booking is written here *first*, before anything else runs, so it can never be lost again |
| Meeting link + calendar | **Google Calendar API** | One call creates the calendar event *and* the Google Meet link, and emails the invite |
| Confirmation emails | **Gmail API** | Same Google account, same credential — no mail password anywhere |

That last row matters: because mail goes through the same OAuth token as the
calendar, there are only **two** credentials to keep alive, not three. SMTP
(Zoho Mail, ZeptoMail, anything else) is still supported as a fallback — see
[Appendix: sending over SMTP instead](#appendix-sending-over-smtp-instead).

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

## Step 2 — Google (Calendar, Meet and email)

You need one Google account — the one that should own the meetings, appear as host, and send the confirmation emails. A free `@gmail.com` account works; you do **not** need Google Workspace.

> [!NOTE]
> If `contact@anyhealth.asia` is a **Google Workspace** mailbox, sign in as it and everything below just works.
>
> If it is a **Zoho mailbox** and your Google account is a separate address (say `anyhealth@gmail.com`), you have two options:
> - Add `contact@anyhealth.asia` to Gmail as a verified **Send mail as** alias (Gmail → Settings → Accounts → *Add another email address*; Gmail asks for the Zoho SMTP details once and then owns the sending). Confirmations then come from `contact@anyhealth.asia` as normal.
> - Or set `FROM_EMAIL` to the Google address and accept that mail comes from there.
>
> Without one of those, Gmail silently rewrites the `From` header to the account's own address. `/api/admin/health` warns you when `FROM_EMAIL` and the sending account disagree.

### 2.1 Create a Google Cloud project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**, signed in as that account.
2. Top bar → project dropdown → **New Project** → name it `AnyHealth Scheduler` → **Create**.

### 2.2 Turn on the two APIs

1. **APIs & Services** → **Library**.
2. Search **Google Calendar API** → **Enable**.
3. Go back to **Library**, search **Gmail API** → **Enable**.

Both are needed: Calendar for the event and Meet link, Gmail for the emails.

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

The consent screen will list three permissions — see your calendars, edit calendar events, and **send email on your behalf**. All three are required; `gmail.send` can only send, it cannot read your inbox.

> [!IMPORTANT]
> A refresh token only carries the scopes it was minted with. If you already generated one before email moved to Gmail, you **must** run `npm run google:auth` again — an existing token is never upgraded, it just starts failing with `403 insufficient authentication scopes`. `/api/admin/health` checks for exactly this and names the missing scope.

> If the script says Google returned no refresh token, revoke the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and run it again.

---

## Step 3 — Email

Nothing to do. Mail goes through the Gmail API on the same credential you just
created, so `MAIL_TRANSPORT=gmail` (the default) is all that is needed.

Two things worth knowing:

- **Sending limits.** A free Google account sends 500 messages/day through the
  API; Workspace allows 2,000. Each booking sends two, so that is 250 bookings
  a day on the free tier.
- **Deliverability.** Mail sent by Gmail is signed with Google's DKIM, so it is
  trusted out of the box. If you use a `Send mail as` alias on
  `anyhealth.asia`, add Google's SPF record (`include:_spf.google.com`) to that
  domain's DNS as well, or some receivers will soft-fail it.

Prefer to keep sending through Zoho? See
[Appendix: sending over SMTP instead](#appendix-sending-over-smtp-instead).

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
   All three checks (`supabase`, `google`, `mail`) should read `"ok": true`. Fix anything that doesn't **before** taking a real booking — this endpoint is the whole point, it tells you the integrations work instead of you finding out from a customer.
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

- **The booking is saved before anything else runs.** The calendar and mail calls happen *after* the Supabase insert, so a failure in either leaves a complete record with the answers intact.
- **Every step records its outcome.** `calendar_status`, `client_email_status` and `practitioner_email_status` on each row, plus an append-only `booking_events` log. A failed email is a red pill on `/admin`, not silence.
- **If Supabase itself is unreachable**, the booking still goes through and you get an `[ACTION NEEDED]` email containing the full payload, so there is always at least one copy.
- **If Google fails**, the customer is told honestly, the row is kept with the error text, and you get an alert with their details so you can follow up by hand.
- **One credential covers calendar and mail**, so there is one thing to keep alive rather than two that can drift apart — and `/api/admin/health` checks the token still carries every scope it needs.
- **`/api/admin/health`** answers "is it all still working?" on demand. Check it after every deploy and after any password or key change.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Health check: `google` fails with `invalid_grant` | Refresh token revoked, or the OAuth consent screen is still **Testing** (7-day expiry). Set it to **In production**, then `npm run google:auth`. |
| Event created but no Meet link | The Calendar API call must include `conferenceDataVersion=1` — it does. If it persists, the Google account is blocked from creating Meet conferences (some Workspace policies); use a personal Google account. |
| Health check: `google` says *missing scope: …gmail.send* | The refresh token predates email moving to Gmail. Run `npm run google:auth` again. |
| Sending fails with `403 insufficient authentication scopes` | Same cause as above. |
| Sending fails with *Gmail API has not been used / is disabled* | Enable the **Gmail API** in Cloud Console → APIs & Services → Library. |
| Emails arrive from the wrong address | `FROM_EMAIL` is not the Google account and not a verified *Send mail as* alias, so Gmail rewrote the `From`. Add the alias in Gmail → Settings → Accounts, or change `FROM_EMAIL`. |
| Health check: `mail` fails with `535 Authentication Failed` (SMTP mode) | Using the login password instead of an app-specific password, or the wrong regional host. |
| SMTP connects locally, times out on Vercel | Port 465 blocked. Set `SMTP_PORT=587` and `SMTP_SECURE=false`. |
| Emails arrive in spam | On Gmail, add `include:_spf.google.com` to the SPF record of any domain you send as. On SMTP, verify SPF/DKIM/DMARC for `anyhealth.asia`. |
| Health check: `supabase` fails with `relation "bookings" does not exist` | `supabase/schema.sql` was never run. |
| `409` when booking | The slot went in the meantime. Genuine — the unique index on `start_utc` is what stops double-booking. |
| `/admin` returns 401 | `ADMIN_TOKEN` missing, under 16 characters, or not matching. |
| No slots show for any date | Check `AVAILABLE_DAYS`, and that `MIN_NOTICE_MINUTES` isn't swallowing the day. |

---

## Security notes

- Every credential is read server-side only; none is exposed to the browser.
- The Google token holds `gmail.send` only — it can send mail as the account, but cannot read, search or delete anything in the mailbox.
- RLS is on with no public policies, so the `anon` key grants nothing.
- Client-supplied text is HTML-escaped before it goes into an email, and escaped per RFC 5545 before it goes into a calendar invite.
- `/admin` is a shared-secret gate. That is proportionate for an internal list — if more than a couple of people need it, put Supabase Auth in front instead of passing the token around.
- Still worth adding before high traffic: rate limiting on `/api/book` (e.g. `@upstash/ratelimit`) and a CAPTCHA if bots start filling slots.

---

## Appendix: sending over SMTP instead

Gmail is the default because it reuses the credential you already have. If you
would rather send through Zoho Mail, ZeptoMail or any other SMTP server, set:

```env
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=contact@anyhealth.asia
SMTP_PASSWORD=your_app_specific_password
```

Nothing else changes — the same message is built either way, so the emails are
byte-identical. `/api/admin/health` verifies whichever transport is active.

**Getting a Zoho app password:** [accounts.zoho.com](https://accounts.zoho.com)
→ **Security** → **App Passwords** → **Generate New Password**. Use your full
email address as `SMTP_USER`. Do not use your normal login password — it fails
outright when two-factor authentication is on.

**Pick the right host:**

| Where your Zoho account lives | `SMTP_HOST` |
|---|---|
| Global / `.com` | `smtp.zoho.com` |
| Europe | `smtp.zoho.eu` |
| India | `smtp.zoho.in` |
| Australia | `smtp.zoho.com.au` |
| ZeptoMail | `smtp.zeptomail.com` |

> [!WARNING]
> Zoho's **Forever Free** plan is webmail only — IMAP/POP/SMTP are not
> included, so SMTP will fail on it. You would need **Mail Lite** (about
> USD 1/user/month) or **ZeptoMail**. This is the main reason Gmail is the
> default: it sidesteps the plan question entirely.

Also verify SPF, DKIM and DMARC for `anyhealth.asia` at your DNS host, or
confirmations land in spam — which looks identical to "the email isn't
working".

The older `ZOHO_SMTP_*` variable names are still read as fallbacks, so an
existing deployment keeps working without an edit.
