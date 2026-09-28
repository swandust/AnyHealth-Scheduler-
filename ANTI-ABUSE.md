# Bot and abuse controls

## Design rule

**Hard-block only on signals a real person cannot trip.** Everything softer is
scored and flagged, and the booking still goes through.

This is not squeamishness. This app exists because enquiries were being lost
silently. A spam filter that quietly eats real leads recreates that failure
with a different cause — and you would not find out for weeks. So: four things
block, everything else just raises a number you can see in `/admin`.

---

## What blocks a booking

| Layer | Catches | Can a human trip it? |
|---|---|---|
| **Honeypot** | Any bot that fills every field it finds | No — the field is off-screen and `aria-hidden` |
| **Email unreachable** | Invented domains, typos like `gmial.com` | No — the domain genuinely has no MX |
| **Disposable address** | `mailinator`, `guerrillamail`, ~28 others | Only if they *want* a throwaway |
| **Blocklist** | Whoever you add by hand | No |
| **Rate limit** | 3/hour, 8/day per IP; 3/day per email | Not at normal use |

The honeypot returns a **fake success** with a plausible booking reference.
Telling a bot precisely why it failed just helps it try again.

## What gets scored, not blocked

`risk_score` (0–100) and `risk_flags` land on the booking row and show in `/admin`.

| Flag | Score | Why it is not a block |
|---|---|---|
| `submitted_too_fast` | 40 | A fast typist on a good connection exists |
| `possible_typo` | 25 | `gmail.co` is a real domain — see below |
| `disposable_email` | 50 | (also hard-blocked, kept for the record) |
| `role_address` | 10 | `info@clinic.sg` is often a genuine practice |
| `automation_user_agent` | 45 | Some corporate proxies rewrite UA |
| `no_user_agent` | 30 | Rare, but privacy tools do this |
| `no_visitor_no_referrer` | 15 | Ad-blockers strip both. **Weak on its own** |
| `challenge_*` | 35 | Token missing or stale — could be a very old tab |

Triage in SQL:

```sql
select booking_ref, client_name, client_email, risk_score, risk_flags, created_at
from bookings
where risk_score >= 40
order by created_at desc;
```

---

## Email verification — what it can and cannot prove

**The Gmail API cannot tell you whether an address exists.** No provider
exposes that: an endpoint answering "is this real?" is an account-enumeration
oracle for spammers. Gmail accepts every address at SMTP `RCPT` stage for the
same reason, and Vercel blocks outbound port 25 regardless.

So the wizard checks, in order:

1. **Syntax.**
2. **MX records** — proves the domain can receive mail. Catches invented
   domains and typos. ~50ms, cached 10 minutes, no third party, no API key.
3. **Disposable list.**
4. **Typo suggestion** — Levenshtein against 18 common providers.

### The typosquat problem

`gmial.com` has no MX, so it is rejected outright. But **`gmail.co` and
`hotmial.com` are registered, have working MX, and pass the MX check happily** —
they are owned by typosquatters. Without a further step, a confirmation email
sails off to a squatter and the lead is gone, looking exactly like the email
failures this project was built to eliminate.

So when a suggestion is found the wizard **blocks until the person chooses**:

> Did you mean **jo@gmail.com**?  [Yes, use that] [No, mine is correct]

They can always keep their address. They just cannot do it by accident.

### If you want actual proof of control

Only one thing proves someone owns an inbox: send a code to it. That is real
friction on a sales funnel, so it is not built. If you want it, the pieces are
in place (Gmail sending works, Supabase can hold the codes) — say so and it can
be added behind an env flag.

---

## The challenge token

`GET /api/book/challenge` issues `v1.<issuedAt>.<nonce>.<hmac>` when the wizard
loads. `/api/book` verifies the signature on submit.

- A script POSTing straight at `/api/book` has no token and cannot mint one
  without `BOOKING_SECRET`.
- The issue time is **inside the signed payload**, so dwell time cannot be
  faked by editing a field. Verified: editing the timestamp fails the signature.
- If `BOOKING_SECRET` is unset, verification is skipped and flagged rather than
  rejecting everyone. Set it.

---

## Blocking someone by hand

```sql
-- one person
insert into blocklist (kind, value, reason)
values ('email', 'someone@example.com', 'repeat spam');

-- a whole domain
insert into blocklist (kind, value, reason)
values ('domain', 'spamdomain.com', 'disposable');

-- unblock
delete from blocklist where value = 'someone@example.com';
```

IPs are stored **hashed** (`ip_hash`), never raw — they are personal data under
PDPA. To block one, copy the `ip_hash` from the booking row and insert it with
`kind = 'ip_hash'`.

## Seeing what is being thrown at the form

```sql
select * from abuse_summary;                      -- last 30 days, grouped
select * from abuse_log order by created_at desc limit 50;
```

`abuse_log` records rejected attempts too. Without it a flood leaves no trace,
because nothing becomes a booking — and it is what the rate limiter counts.

---

## Tuning

| Variable | Default | Notes |
|---|---|---|
| `BOOKING_SECRET` | falls back to `ADMIN_TOKEN` | Set explicitly, so rotating the admin token does not void every open form |
| `MIN_FORM_SECONDS` | `8` | Below this, `submitted_too_fast` |
| `RATE_LIMIT_PER_HOUR` | `3` | Per IP |
| `RATE_LIMIT_PER_DAY` | `8` | Per IP |
| `RATE_LIMIT_EMAIL_PER_DAY` | `3` | Per email |

If a genuine clinic books for several colleagues from one office, they will hit
the per-IP limit. Raise it rather than telling them to try tomorrow.

## If bots get past all this

These stop scripted abuse, not a determined human. The next step is
**Cloudflare Turnstile** — free, invisible for most visitors, ~20 lines to add
at `/api/book`. Worth doing only if you actually see sustained abuse; it is
another dependency and a small conversion cost.
