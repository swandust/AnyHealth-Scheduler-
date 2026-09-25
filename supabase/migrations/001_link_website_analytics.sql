-- ============================================================================
-- Link bookings to the website's existing analytics tables.
--
-- Run this in the Supabase SQL Editor AFTER schema.sql. It is additive and
-- idempotent: it only adds columns and views, and touches no existing data in
-- website_leads or website_events.
--
-- The join key is visitor_id, the uuid your site's tracker already stamps on
-- website_events and website_leads. Until now the scheduler never saw it, so
-- bookings could not be tied to anyone.
-- ============================================================================

-- ── 1. Carry the website identity onto each booking ────────────────────────
alter table public.bookings add column if not exists visitor_id  uuid;
alter table public.bookings add column if not exists session_id  uuid;
alter table public.bookings add column if not exists source_path text;
alter table public.bookings add column if not exists referrer    text;
alter table public.bookings add column if not exists utm         jsonb not null default '{}'::jsonb;

create index if not exists bookings_visitor_id_idx on public.bookings (visitor_id);
create index if not exists bookings_session_id_idx on public.bookings (session_id);

-- Matching leads to events by visitor is the hot path for every query below.
create index if not exists idx_leads_visitor  on public.website_leads  (visitor_id);
create index if not exists idx_events_visitor on public.website_events (visitor_id, created_at desc);

-- ── 2. One row per visitor: what they did, end to end ──────────────────────
-- Answers "who came in, who made bookings". A visitor appears here if they
-- triggered any event, submitted a lead, or booked.
create or replace view public.visitor_journey as
with visitors as (
  select visitor_id from public.website_events where visitor_id is not null
  union
  select visitor_id from public.website_leads  where visitor_id is not null
  union
  select visitor_id from public.bookings       where visitor_id is not null
),
event_stats as (
  select
    visitor_id,
    min(created_at)                          as first_seen,
    max(created_at)                          as last_seen,
    count(*)                                 as event_count,
    count(distinct session_id)               as session_count,
    count(*) filter (where event_name = 'page_view') as page_views,
    (array_agg(path order by created_at))[1] as landing_path
  from public.website_events
  where visitor_id is not null
  group by visitor_id
),
lead_stats as (
  select distinct on (visitor_id)
    visitor_id, id as lead_id, name as lead_name, email as lead_email,
    organisation, role as lead_role, interest, created_at as lead_at
  from public.website_leads
  where visitor_id is not null
  order by visitor_id, created_at desc
),
booking_stats as (
  select
    visitor_id,
    count(*)                                        as booking_count,
    count(*) filter (where status = 'confirmed')    as confirmed_count,
    max(created_at)                                 as last_booking_at,
    (array_agg(booking_ref order by created_at desc))[1] as latest_booking_ref
  from public.bookings
  where visitor_id is not null
  group by visitor_id
)
select
  v.visitor_id,
  e.first_seen,
  e.last_seen,
  e.landing_path,
  coalesce(e.event_count, 0)    as event_count,
  coalesce(e.page_views, 0)     as page_views,
  coalesce(e.session_count, 0)  as session_count,
  l.lead_id is not null         as submitted_lead,
  l.lead_name,
  l.lead_email,
  l.organisation,
  l.lead_role,
  l.interest,
  l.lead_at,
  coalesce(b.booking_count, 0)    as booking_count,
  coalesce(b.confirmed_count, 0)  as confirmed_bookings,
  b.latest_booking_ref,
  b.last_booking_at,
  -- Furthest stage reached. Keyed on booking_count, not confirmed_count: a
  -- booking that is still pending (or that failed at Google) is still someone
  -- who tried to book, and must not be reported as a mere visitor.
  case
    when coalesce(b.booking_count, 0) > 0 then 'booked'
    when l.lead_id is not null            then 'lead'
    when coalesce(e.event_count, 0) > 0   then 'visitor'
    else 'unknown'
  end as stage
from visitors v
left join event_stats   e using (visitor_id)
left join lead_stats    l using (visitor_id)
left join booking_stats b using (visitor_id);

-- ── 3. Each booking, enriched with where the person came from ────────────────
create or replace view public.booking_attribution as
select
  b.booking_ref,
  b.status,
  b.client_name,
  b.client_email,
  b.slot_date,
  b.slot_time,
  b.start_utc,
  b.visitor_id,
  b.source_path,
  b.referrer,
  b.utm,
  -- Match the lead by visitor first, then fall back to email: someone can
  -- submit a lead on their phone and book on a laptop, which is a different
  -- visitor_id but the same person.
  coalesce(lv.id, le.id)                     as lead_id,
  coalesce(lv.organisation, le.organisation) as organisation,
  coalesce(lv.interest, le.interest)         as interest,
  coalesce(lv.created_at, le.created_at)     as lead_at,
  case
    when lv.id is not null then 'visitor_id'
    when le.id is not null then 'email'
    else 'unmatched'
  end                                        as lead_match,
  j.first_seen,
  j.page_views,
  j.event_count,
  case
    when j.first_seen is not null
      then b.created_at - j.first_seen
  end                                        as time_to_book
from public.bookings b
left join lateral (
  select * from public.website_leads wl
  where b.visitor_id is not null and wl.visitor_id = b.visitor_id
  order by wl.created_at desc limit 1
) lv on true
left join lateral (
  select * from public.website_leads wl
  where b.client_email is not null
    and lower(wl.email) = lower(b.client_email)
  order by wl.created_at desc limit 1
) le on true
left join public.visitor_journey j on j.visitor_id = b.visitor_id;

-- ── 4. Funnel counts, last 30 days ─────────────────────────────────────────
create or replace view public.funnel_30d as
select
  count(*)                                        as visitors,
  count(*) filter (where submitted_lead)          as leads,
  count(*) filter (where booking_count > 0)       as booked,
  count(*) filter (where confirmed_bookings > 0)  as confirmed,
  round(100.0 * count(*) filter (where submitted_lead)
        / nullif(count(*), 0), 1)                 as pct_visitor_to_lead,
  -- Of the visitors who submitted a lead, how many went on to book. The
  -- numerator must be constrained to lead-submitters too, otherwise someone
  -- who booked without ever leaving a lead inflates the rate (and it can
  -- even exceed 100%).
  round(100.0 * count(*) filter (where submitted_lead and booking_count > 0)
        / nullif(count(*) filter (where submitted_lead), 0), 1) as pct_lead_to_booking,
  -- Bookings whose visitor is unknown never appear above, so report them
  -- separately rather than letting them quietly deflate the funnel.
  (select count(*) from public.bookings
    where visitor_id is null
      and created_at > now() - interval '30 days')            as bookings_without_visitor
from public.visitor_journey
where coalesce(first_seen, lead_at, last_booking_at) > now() - interval '30 days';

-- Views inherit RLS from their base tables; both analytics tables should have
-- RLS enabled so only the service role reads them.
alter table public.website_leads  enable row level security;
alter table public.website_events enable row level security;
