-- ============================================================================
-- AnyHealth Scheduler — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- bookings — one row per booking attempt. Written BEFORE any external API call
-- so that a booking is never lost even if Google or Zoho is down.
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id                         uuid primary key default gen_random_uuid(),
  booking_ref                text not null unique,

  -- lifecycle: pending → confirmed | failed  (or cancelled later, by hand)
  status                     text not null default 'pending'
                             check (status in ('pending','confirmed','failed','cancelled')),

  -- who
  client_name                text not null,
  -- nullable only so recovered history (Zoom kept no email) can be stored;
  -- the booking API always requires one.
  client_email               text,
  client_phone               text,

  -- the intake answers
  role                       text,                       -- step 2 of the wizard
  challenges                 text[] not null default '{}',-- step 3 of the wizard
  answers                    jsonb  not null default '{}'::jsonb, -- full raw payload

  -- when (SGT wall-clock is what the UI works in; *_utc is the real instant)
  slot_date                  date not null,
  slot_time                  text not null,              -- "14:30"
  start_local                text not null,              -- "2026-07-10T14:30:00"
  end_local                  text not null,
  start_utc                  timestamptz not null,
  end_utc                    timestamptz not null,
  timezone                   text not null default 'Asia/Singapore',
  duration_minutes           int  not null default 30,

  -- Google Meet / Google Calendar
  meet_url                   text,
  google_event_id            text,
  google_html_link           text,
  calendar_status            text not null default 'pending'
                             check (calendar_status in ('pending','ok','failed','skipped')),
  calendar_error             text,

  -- Zoho Mail
  client_email_status        text not null default 'pending'
                             check (client_email_status in ('pending','sent','failed','skipped')),
  practitioner_email_status  text not null default 'pending'
                             check (practitioner_email_status in ('pending','sent','failed','skipped')),
  email_error                text,

  -- provenance
  source                     text not null default 'web', -- 'web' | 'zoom-backfill' | 'manual'
  user_agent                 text,
  ip_hash                    text,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists bookings_start_utc_idx    on public.bookings (start_utc);
create index if not exists bookings_created_at_idx   on public.bookings (created_at desc);
create index if not exists bookings_status_idx       on public.bookings (status);
create index if not exists bookings_client_email_idx on public.bookings (lower(client_email));
create index if not exists bookings_answers_gin      on public.bookings using gin (answers);

-- Stops the same slot being double-booked by two concurrent requests.
-- Cancelled/failed rows are excluded so a freed slot can be rebooked.
create unique index if not exists bookings_one_per_slot
  on public.bookings (start_utc)
  where status in ('pending','confirmed');

-- ---------------------------------------------------------------------------
-- booking_events — an append-only log of every step of every booking.
-- This is the "what actually happened" trail: if an email silently fails
-- again, the failure is a row here rather than a lost customer.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_events (
  id          bigserial primary key,
  booking_id  uuid references public.bookings(id) on delete cascade,
  booking_ref text,
  step        text not null,   -- 'received' | 'google_calendar' | 'email_client' | ...
  ok          boolean not null,
  message     text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists booking_events_booking_id_idx on public.booking_events (booking_id);
create index if not exists booking_events_created_at_idx on public.booking_events (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The app talks to Supabase with the SERVICE ROLE key from server-side code
-- only, which bypasses RLS. No anon/public policy is created on purpose, so a
-- leaked anon key still cannot read a single patient record.
-- ---------------------------------------------------------------------------
alter table public.bookings       enable row level security;
alter table public.booking_events enable row level security;

-- ---------------------------------------------------------------------------
-- Convenience view for the admin screen
-- ---------------------------------------------------------------------------
create or replace view public.bookings_overview as
select
  b.booking_ref,
  b.status,
  b.client_name,
  b.client_email,
  b.client_phone,
  b.role,
  b.challenges,
  b.slot_date,
  b.slot_time,
  b.start_utc,
  b.meet_url,
  b.calendar_status,
  b.client_email_status,
  b.practitioner_email_status,
  b.source,
  b.created_at
from public.bookings b
order by b.start_utc desc;
