# Linking bookings to website visitors

## The short answer

They were **not** linked. Your site writes `website_events` and `website_leads`,
both keyed on `visitor_id`, but the scheduler had no idea that column existed —
it never read a cookie and never stored an id. Every booking was an island: you
could see *that* someone booked, never *which visitor* they were.

This is now wired up. The join key is the `visitor_id` your tracker already sets.

```
website_events   ─┐
                  ├─ visitor_id ─→  bookings.visitor_id
website_leads    ─┘                 (falls back to matching on email)
```

---

## What you must do — three things

### 1. Run the migration

Supabase → **SQL Editor** → **New query** → paste
[`supabase/migrations/001_link_website_analytics.sql`](supabase/migrations/001_link_website_analytics.sql)
→ **Run**.

It only adds columns and views. It does not touch a single existing row in
`website_leads` or `website_events`.

### 2. Tell the scheduler your cookie name

The tracker on your site stores the visitor id under *some* name. I don't know
which, so the code tries a list: `ah_vid`, `visitor_id`, `anyhealth_visitor_id`,
`ah_visitor`. If yours isn't one of those, attribution silently stays empty.

Find it: open your site, DevTools → **Application** → **Cookies** (and
**Local Storage**), and look for the uuid. Then set it in `.env.local` and Vercel:

```env
NEXT_PUBLIC_VISITOR_COOKIE=your_cookie_name
NEXT_PUBLIC_SESSION_COOKIE=your_session_cookie_name
```

### 3. Deal with the domain split — this is the one that bites

**Cookies do not cross domains.** If your site is `anyhealth.asia` and the
scheduler is on `anyhealth-scheduler.vercel.app`, that is a different origin:
no cookie, no localStorage, nothing carries over. Attribution would be empty
for every booking and nothing would *look* broken.

Pick one:

**Option A — pass the id on the link (works anywhere, do this today).**
Change the "Book a call" button on your site to carry the visitor id:

```html
<a id="book-cta" href="https://your-scheduler-url/book">Book a call</a>

<script>
  // Use whatever your tracker calls it.
  const vid = getCookie('ah_vid');
  const sid = getCookie('ah_sid');
  const cta = document.getElementById('book-cta');
  const url = new URL(cta.href);
  if (vid) url.searchParams.set('vid', vid);
  if (sid) url.searchParams.set('sid', sid);
  url.searchParams.set('from', location.pathname);
  cta.href = url.toString();
</script>
```

**Option B — put both on one domain (cleaner long-term).**
Host the scheduler at `book.anyhealth.asia` (Vercel → Settings → Domains), and
have your tracker set the cookie with `Domain=.anyhealth.asia`. Then set:

```env
NEXT_PUBLIC_COOKIE_DOMAIN=.anyhealth.asia
```

The query parameter still takes priority, so doing both is fine and safest.

> Even with none of this, bookings are **not** orphaned: `booking_attribution`
> falls back to matching `website_leads.email` against `bookings.client_email`.
> Someone who filled in your lead form and later booked will still be matched,
> just via email rather than visitor id. The `lead_match` column tells you which
> route matched (`visitor_id`, `email`, or `unmatched`).

---

## What you get

Three views, all verified against sample data on a real Postgres:

### `visitor_journey` — one row per visitor

Who came in, how far they got.

```sql
select * from visitor_journey order by first_seen desc limit 50;
```

| column | meaning |
|---|---|
| `stage` | `visitor` → `lead` → `booked`, the furthest point reached |
| `first_seen` / `last_seen` | from `website_events` |
| `page_views`, `event_count`, `session_count` | activity |
| `landing_path` | the first page they hit |
| `submitted_lead`, `lead_name`, `lead_email`, `organisation`, `interest` | from `website_leads` |
| `booking_count`, `confirmed_bookings`, `latest_booking_ref` | from `bookings` |

`stage` is keyed on *any* booking, not just confirmed ones — someone whose
booking failed at Google still tried to book, and must not read as a passer-by.

### `booking_attribution` — one row per booking, with its origin

```sql
select booking_ref, client_name, lead_match, organisation, interest,
       source_path, utm->>'utm_source' as source, time_to_book
from booking_attribution
order by start_utc desc;
```

`time_to_book` is the gap between first page view and booking — a decent proxy
for how long your funnel takes to convert.

### `funnel_30d` — the headline numbers

```sql
select * from funnel_30d;
```

Gives `visitors`, `leads`, `booked`, `confirmed`, `pct_visitor_to_lead`,
`pct_lead_to_booking`, and `bookings_without_visitor` — that last one is your
attribution health check. If it is high, step 3 above isn't working.

---

## Useful queries

**Who booked this week, and where did they come from?**
```sql
select client_name, client_email, organisation, source_path,
       utm->>'utm_source' as source, lead_match, slot_date, slot_time
from booking_attribution
where start_utc between now() and now() + interval '7 days'
order by start_utc;
```

**Leads who never booked — your follow-up list.**
```sql
select lead_name, lead_email, organisation, interest, lead_at, page_views
from visitor_journey
where submitted_lead and booking_count = 0
order by lead_at desc;
```

**Which pages lead to bookings?**
```sql
select source_path, count(*) as bookings
from booking_attribution
where source_path is not null
group by source_path
order by bookings desc;
```

**Which campaigns actually convert?**
```sql
select coalesce(utm->>'utm_source', 'direct') as source,
       count(*) as bookings,
       count(*) filter (where status = 'confirmed') as confirmed
from booking_attribution
group by 1
order by bookings desc;
```

**Did anyone book without ever appearing in analytics?** (attribution gaps)
```sql
select booking_ref, client_name, client_email, created_at
from booking_attribution
where lead_match = 'unmatched' and visitor_id is null
order by created_at desc;
```

---

## One caveat worth reading

You are now joining browsing behaviour to named people in a healthcare context.
That is exactly the kind of linkage PDPA (Singapore) and PDPA (Malaysia) care
about. Two practical points:

- Make sure your site's privacy notice and cookie banner actually cover
  analytics that identify individuals, not just "anonymous statistics" — once
  `visitor_id` is joined to a name and email, it is no longer anonymous.
- `website_events` and `website_leads` now have RLS enabled by the migration.
  Only the service role reads them. Don't add a public policy for convenience.
