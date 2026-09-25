# HANDOFF — AnyHealth Scheduler

> **Human:** start a local session in this repo and say:
> *"Read HANDOFF.md and help me finish the setup."*
> Everything below is written for the agent picking this up cold.

---

## 1. Brief for the agent

You are continuing work on the AnyHealth consultation scheduler. A previous
session (running in a cloud container, no access to the user's machine) migrated
it off Microsoft/Zoom and onto Supabase + Google, and wired it to the website's
analytics tables. **All code is written, builds clean, and is pushed.** What
remains is account setup, which needs the user in a browser.

**Your first job is not to write code.** It is to walk the user through Sections
5–7 and get `/api/admin/health` returning three greens. Read `SETUP.md` for the
click-by-click; this file is the context around it.

**Repo state**

| | |
|---|---|
| Branch | `claude/kind-bardeen-0cpvs1` (3 commits ahead of `main`) |
| Head | `8fb86d1` |
| Remote | https://github.com/swandust/AnyHealth-Scheduler- |
| `main` | still the OLD Outlook/Zoom code — do not deploy it |

```bash
git clone https://github.com/swandust/AnyHealth-Scheduler-.git
cd AnyHealth-Scheduler-
git checkout claude/kind-bardeen-0cpvs1
npm install
```

Commits: `b7acd97` Supabase + Meet migration · `fa68c7a` Gmail sending ·
`8fb86d1` website attribution.

---

## 2. Why this rewrite happened (don't undo it)

The old flow was: create a Zoom meeting → write an Outlook event via Microsoft
Graph → send two emails via Graph. **Nothing was written to a database.** The
calendar write and both email sends sat inside `try/catch` blocks that only
called `console.error`, so when Graph auth died, all three failed *silently*, the
API still returned `success: true`, and the customer saw a confirmation page.

The user lost their entire booking history this way and had no way to know who
they'd missed. Every design choice below follows from that:

- **The Supabase insert happens before any external call.** Not after. Not in
  parallel. If you refactor `src/app/api/book/route.ts`, keep that ordering.
- **Every step records its outcome** on the booking row (`calendar_status`,
  `client_email_status`, `practitioner_email_status`) plus an append-only
  `booking_events` log.
- **Nothing fails silently.** If Supabase is unreachable the booking still goes
  through and an `[ACTION NEEDED]` email carries the full payload. If Google
  fails, the row is kept with the error text and the user is alerted.

---

## 3. Architecture

```
/book  ──▶  POST /api/book
              │
              ├─ 1. INSERT into Supabase          ← first, always
              ├─ 2. Google Calendar event + Meet link
              ├─ 3. Gmail: client confirmation + internal notification
              ├─ 4. write booking_completed into website_events
              └─ 5. record each step's outcome on the row
```

| Concern | Service | Credential |
|---|---|---|
| Database | Supabase | `SUPABASE_SERVICE_ROLE_KEY` (server-side only) |
| Calendar + Meet | Google Calendar API | Google OAuth refresh token |
| Email | Gmail API | **the same** refresh token |

Calendar and email share one credential deliberately — two things to keep alive
instead of three. SMTP (Zoho/ZeptoMail) still works as a fallback via
`MAIL_TRANSPORT=smtp`.

**Key files**

| Path | Role |
|---|---|
| `src/app/api/book/route.ts` | The whole booking pipeline. Start here. |
| `src/lib/supabase.ts` | DB client + `insertBooking` / `updateBooking` / `logBookingEvent` / `recordWebsiteEvent` |
| `src/lib/googleAuth.ts` | Shared OAuth token cache + granted-scope check |
| `src/lib/googleCalendar.ts` | Event creation (Meet link) + free/busy |
| `src/lib/gmailSender.ts` | Gmail API send; MIME built by nodemailer's MailComposer |
| `src/lib/mailer.ts` | Transport dispatch (gmail ⇄ smtp) |
| `src/lib/emailService.ts` | The two HTML templates |
| `src/lib/availability.ts` | Slot generation, minus Google busy time and taken slots |
| `src/lib/time.ts` | All timezone maths — see gotcha #4 |
| `src/lib/ics.ts` | RFC 5545 generator |
| `src/lib/visitor.ts` | Website visitor identity resolution |
| `supabase/schema.sql` | Run first |
| `supabase/migrations/001_link_website_analytics.sql` | Run second |
| `SETUP.md` | Click-by-click account setup |
| `ANALYTICS.md` | Attribution setup + query cookbook |

---

## 4. What is done, and how it was verified

Don't re-verify these unless something changes.

- `npm run build` and `npm run typecheck` pass.
- **Timezone helpers** — unit-tested: SGT↔UTC, `23:30 + 30min` rolling to the
  next day, month/year rollover, and DST zones (Europe/London in BST and GMT).
- **ICS output** — escapes `,` `;` `\` and newlines per RFC 5545, folds at 75
  octets. *(The old code didn't escape commas, and the challenge list is
  comma-joined, so those invites were malformed.)*
- **Gmail send path** — exercised end to end with a stubbed network: token
  refresh, MIME build, base64url encoding, API call shape, and the resulting
  message (From/To/Reply-To, HTML + plaintext + `text/calendar` alternative +
  `.ics` attachment).
- **Transport selection** — all six env combinations.
- **Visitor resolution** — 11 cases: query-param priority, cookie fallback,
  alternate cookie names, localStorage fallback, malformed-UUID rejection.
- **SQL** — applied to a real Postgres 16 with seeded data covering
  visitor-only, lead-without-booking, visitor-matched booking, email-matched
  booking with no `visitor_id`, and booking with no lead. Verified idempotent
  and clean on a fresh database.
- **API error paths** — 400 validation, 409 slot-taken, 503 Google-missing,
  401 unauthorised.

Not tested (impossible without live credentials): a real booking against real
Supabase/Google. **That is Section 7.**

---

## 5. What is NOT done

Nothing is configured. No Supabase project, no Google Cloud project, no env
vars, not deployed. `.env.local` does not exist.

These steps need the user signed into their own accounts in a browser — you
cannot do them, so guide, don't attempt:

1. Create the Supabase project, run the two SQL files.
2. Create the Google Cloud project, enable **Calendar API** *and* **Gmail API**.
3. Configure + **publish** the OAuth consent screen.
4. Create the OAuth client with redirect URI `http://localhost:5555/oauth2callback`.
5. Run `npm run google:auth` (you *can* run this) and have them approve in-browser.
6. Fill `.env.local` from `.env.example`.
7. Deploy to Vercel with the branch set as production branch.

`SETUP.md` has every click. Work through it with them one section at a time.

---

## 6. Ask the user these before you start

1. **Is `contact@anyhealth.asia` a Google account?** Have them try signing in at
   accounts.google.com. If yes → Workspace, use it everywhere. If no → their
   Google account is a different address, and `FROM_EMAIL` needs either a
   verified *Send mail as* alias in Gmail or to be changed. See gotcha #2.
2. **What cookie name does their website tracker use for `visitor_id`?**
   DevTools → Application → Cookies. Needed for `NEXT_PUBLIC_VISITOR_COOKIE`.
   See gotcha #3.
3. **Will the scheduler live on a subdomain of `anyhealth.asia`, or on
   `*.vercel.app`?** This decides whether cookie-based attribution can work at
   all. See gotcha #3.
4. **Do they still have the old Zoom credentials, or access to the old Outlook
   mailbox?** Determines whether lost history is recoverable. See Section 8.

---

## 7. Getting to green

```bash
npm run dev
```

Open `http://localhost:3000/api/admin/health?token=<ADMIN_TOKEN>`.
All three — `supabase`, `google`, `mail` — must be `"ok": true`.

**Do not skip this and do not proceed past a red check.** This endpoint exists
precisely because the old system's failures were invisible. Teach the user to
hit it after every deploy and every credential change.

Then a real test booking at `/book` with their own email, and confirm all four:
row in `/admin`, event in Google Calendar, Meet link works, both emails arrive.

---

## 8. Gotchas — read before debugging

**1. OAuth consent screen must be "In production".**
While it says *Testing*, Google expires the refresh token after **7 days** and
bookings silently stop. This is the same shape of failure that destroyed their
history. Check it first if things work and then stop working a week later.

**2. A refresh token only carries the scopes it was minted with.**
Adding a scope never upgrades an existing token — it starts failing with
`403 insufficient authentication scopes`. Fix: re-run `npm run google:auth`.
`/api/admin/health` checks granted scopes explicitly and names the missing one.
Related: if `FROM_EMAIL` is neither the Google account nor a verified *Send mail
as* alias, **Gmail silently rewrites the From header**. The health check warns.

**3. Cookies do not cross domains — the attribution trap.**
Site on `anyhealth.asia`, scheduler on `*.vercel.app` = different origin, no
cookie, and attribution comes back empty for every booking *while nothing looks
broken*. This is why `src/lib/visitor.ts` prioritises the `?vid=` query
parameter over cookies. The site's "Book a call" link must append it — snippet
in `ANALYTICS.md`. Health check: `funnel_30d.bookings_without_visitor`.
Safety net: `booking_attribution` also matches on email.

**4. Never reintroduce `h - 8` timezone maths.**
The old code hard-coded the SGT offset in five files and broke the 23:30 slot's
end date. Everything goes through `src/lib/time.ts` (Intl-based) and the zone is
config (`BOOKING_TIMEZONE`).

**5. Slot times come from the server.**
The frontend used to hold a hardcoded 45-minute list while the server generated
30-minute slots. Labels now derive from `/api/availability`. Don't hardcode.

**6. `main` is the old code.** Vercel defaults to it. Either set the production
branch or merge the PR first.

**7. Double-booking is prevented by a partial unique index** on
`bookings.start_utc` (status in pending/confirmed), not by application logic.
That's why availability degrades *open* when Google is unreachable — the DB is
the real guard.

**8. Recovering the lost history.** `npm run recover -- --zoom` pulls past
meetings from the old Zoom account (gives name + date/time; Zoom never stored
email). `npm run recover -- --ics <file>` reads an exported Outlook calendar and
is the *richer* source — those event bodies held name, email, goal and
challenges. Both take `--dry-run` and `--csv`. Do this before the old accounts
are closed.

---

## 9. Sensible next work (only after green)

- Rate limiting on `POST /api/book` (`@upstash/ratelimit`) — currently none.
- Reschedule/cancel flow. `deleteEvent()` exists in `googleCalendar.ts` and is
  unused; `bookings.status` already has a `cancelled` value.
- Automated tests. Verification so far was ad-hoc scripts, not a suite.
- Replace the `/admin` shared-secret gate with Supabase Auth if more than a
  couple of people need access.

---

## 10. House rules

- `AGENTS.md`: this is Next.js 16 with breaking changes — read
  `node_modules/next/dist/docs/` before writing framework code, don't rely on
  training data.
- Never commit `.env.local`. `.gitignore` covers `.env*` with an exception for
  `.env.example`.
- The `service_role` key bypasses RLS. Server-side only, never in a client
  component.
- RLS is on for `bookings`, `booking_events`, `website_leads`, `website_events`
  with **no public policies**, on purpose. Don't add one for convenience.
- They're joining browsing behaviour to named people in healthcare — PDPA
  (SG/MY) territory. Their privacy notice should cover analytics that identify
  individuals, not just "anonymous statistics".
