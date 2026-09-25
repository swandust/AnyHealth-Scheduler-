# AnyHealth Smart Intake Scheduler

A five-step intake wizard that books a 30-minute consultation: it saves the answers to
Supabase, creates a Google Calendar event with a Google Meet link, and sends branded
confirmation emails through Gmail.

```
 /book  ──▶  POST /api/book
               │
               ├─ 1. INSERT into Supabase          ← happens first, always
               ├─ 2. Google Calendar event + Meet link
               ├─ 3. Gmail: client confirmation + internal notification
               └─ 4. record the outcome of each step back on the row
```

Step 1 comes first on purpose. Whatever Google does afterwards, the booking and
the intake answers are already on disk — the failure mode that wiped the old history
cannot repeat.

## Stack

| Concern | Service |
|---|---|
| Framework | Next.js 16 (App Router) |
| Database | Supabase (Postgres, RLS on, service-role access from the server only) |
| Calendar + video | Google Calendar API — the event and the Meet link come from one call |
| Email | Gmail API — same Google account, same OAuth token, no mail password |

Calendar and email share one credential, so there are two accounts to keep alive
rather than three. SMTP (Zoho Mail, ZeptoMail, anything else) still works as a
fallback: set `MAIL_TRANSPORT=smtp`.

Previously Microsoft Graph/Outlook + Zoom; both have been removed.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill it in — see SETUP.md
npm run dev
```

Full walkthrough, including where every credential comes from: **[SETUP.md](SETUP.md)**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run google:auth` | One-time OAuth flow that prints `GOOGLE_REFRESH_TOKEN` |
| `npm run recover -- --zoom` | Rebuild lost history from the old Zoom account |
| `npm run recover -- --ics <file>` | Rebuild lost history from an exported calendar |

Both recovery modes take `--dry-run` and `--csv`.

## Routes

| Route | Purpose |
|---|---|
| `/book` | The intake wizard |
| `/confirmed` | Confirmation page with the Meet link and an .ics download |
| `/admin` | Every booking, with the status of each step (needs `ADMIN_TOKEN`) |
| `GET /api/availability?date=YYYY-MM-DD` | Bookable slots, minus Google busy time and slots already held |
| `POST /api/book` | Creates the booking |
| `GET /api/admin/health` | Live check of Supabase, Google (incl. granted scopes) and mail — run after every deploy |
| `GET /api/admin/bookings` | JSON list of bookings |

## Where the answers live

`public.bookings` holds one row per booking: the client's details, `role` and
`challenges` as their own columns, the whole submitted form as `answers` (JSONB), the
Meet link and Google event ID, and the status of the calendar write and each email.
`public.booking_events` is an append-only log of every step. Between them, "what did I
miss?" is a query rather than a guess.
