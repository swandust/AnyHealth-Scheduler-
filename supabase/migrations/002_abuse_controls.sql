-- ============================================================================
-- Bot / abuse controls.
--
-- Design rule: HARD-BLOCK only on signals a real person cannot trip (honeypot,
-- forged or missing challenge token, explicit blocklist, rate limit). Anything
-- softer is SCORED and flagged, and the booking still goes through.
--
-- The whole point of this app is that no genuine enquiry is ever silently
-- lost. A spam filter that quietly eats real leads would reintroduce exactly
-- the failure we just spent three commits removing.
-- ============================================================================

-- ── 1. Risk fields on each booking ─────────────────────────────────────────
alter table public.bookings add column if not exists risk_score int not null default 0;
alter table public.bookings add column if not exists risk_flags text[] not null default '{}';

create index if not exists bookings_risk_score_idx on public.bookings (risk_score desc)
  where risk_score > 0;

-- ── 2. Abuse log: every attempt, including the rejected ones ───────────────
-- Rejected attempts never become bookings, so without this table a flood would
-- be invisible. Keep it: it is the evidence when deciding whether to block.
create table if not exists public.abuse_log (
  id          bigserial primary key,
  ip_hash     text,
  email       text,
  kind        text not null,        -- 'attempt' | 'blocked' | 'flagged'
  reason      text,
  detail      jsonb not null default '{}'::jsonb,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists abuse_log_ip_time_idx    on public.abuse_log (ip_hash, created_at desc);
create index if not exists abuse_log_email_time_idx on public.abuse_log (lower(email), created_at desc);
create index if not exists abuse_log_created_idx    on public.abuse_log (created_at desc);

-- ── 3. Manual blocklist ────────────────────────────────────────────────────
-- Add a row to block. `value` is an email, a bare domain, or an ip_hash.
create table if not exists public.blocklist (
  id         bigserial primary key,
  kind       text not null check (kind in ('email', 'domain', 'ip_hash')),
  value      text not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

-- Case-insensitive matching on emails and domains.
create unique index if not exists blocklist_kind_value_lower
  on public.blocklist (kind, lower(value));

-- ── 4. Rate-limit check, evaluated in the database ─────────────────────────
-- Counting in the database rather than in the app matters: serverless
-- functions do not share memory, so an in-process counter resets on every cold
-- start and a burst slips straight through.
create or replace function public.check_booking_rate_limit(
  p_ip_hash        text,
  p_email          text,
  p_max_per_hour   int default 3,
  p_max_per_day    int default 8,
  p_max_email_day  int default 3
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip_hour  int := 0;
  v_ip_day   int := 0;
  v_email_day int := 0;
begin
  if p_ip_hash is not null then
    select count(*) into v_ip_hour
    from public.abuse_log
    where ip_hash = p_ip_hash
      and kind in ('attempt', 'flagged')
      and created_at > now() - interval '1 hour';

    select count(*) into v_ip_day
    from public.abuse_log
    where ip_hash = p_ip_hash
      and kind in ('attempt', 'flagged')
      and created_at > now() - interval '1 day';
  end if;

  if p_email is not null then
    select count(*) into v_email_day
    from public.bookings
    where lower(client_email) = lower(p_email)
      and status in ('pending', 'confirmed')
      and created_at > now() - interval '1 day';
  end if;

  if v_ip_hour >= p_max_per_hour then
    return query select false, format('%s bookings from this address in the last hour', v_ip_hour);
  elsif v_ip_day >= p_max_per_day then
    return query select false, format('%s bookings from this address today', v_ip_day);
  elsif v_email_day >= p_max_email_day then
    return query select false, format('%s bookings for this email today', v_email_day);
  else
    return query select true, null::text;
  end if;
end;
$$;

-- ── 5. What is being thrown at the form ────────────────────────────────────
create or replace view public.abuse_summary as
select
  date_trunc('day', created_at) as day,
  kind,
  reason,
  count(*)                      as hits,
  count(distinct ip_hash)       as distinct_ips
from public.abuse_log
where created_at > now() - interval '30 days'
group by 1, 2, 3
order by 1 desc, hits desc;

-- ── 6. RLS: service role only, as with every other table here ──────────────
alter table public.abuse_log enable row level security;
alter table public.blocklist enable row level security;

-- ── How to block someone ───────────────────────────────────────────────────
--   insert into blocklist (kind, value, reason)
--     values ('email', 'someone@example.com', 'repeat spam');
--   insert into blocklist (kind, value, reason)
--     values ('domain', 'spamdomain.com', 'disposable');
-- To unblock:  delete from blocklist where value = '...';
