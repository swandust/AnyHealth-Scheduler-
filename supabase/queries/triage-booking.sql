-- ============================================================================
-- Is this booking real or junk? Run these before blocking anyone.
-- Replace AH-XXXX with the booking_ref.
-- ============================================================================

-- 1. THE DECIDER. booking_attribution deliberately does not select these, so
--    the columns that actually tell you whether a human filled the form in
--    were missing from what you looked at.
select
  booking_ref, created_at, client_name, client_email, client_phone,
  role,                                   -- they picked this in step 2
  challenges,                             -- and these in step 3
  user_agent,                             -- a real browser vs a script
  answers->>'submittedAt'  as submitted_at,
  answers                                 -- the entire raw payload
from bookings
where booking_ref = 'AH-MULFGLQ1-3URW';

-- A five-step wizard with a plausible role, 1+ challenges and a real browser
-- user-agent is very hard for a naive bot to fake. Empty role, empty
-- challenges, or a user_agent like python-requests/curl is the tell.

-- 2. Did the pipeline treat it normally?
select step, ok, message, created_at
from booking_events
where booking_ref = 'AH-MULFGLQ1-3URW'
order by created_at;

-- 3. Is the MISSING ATTRIBUTION systemic, or unique to this person?
--    If most rows have no visitor_id, the tracking link is broken —
--    that is a bug, not a bot. (See ANALYTICS.md, the domain-split section.)
select
  count(*)                                        as bookings,
  count(visitor_id)                               as with_visitor_id,
  count(*) - count(visitor_id)                    as without,
  round(100.0 * count(visitor_id) / nullif(count(*),0), 1) as pct_attributed
from bookings
where created_at > now() - interval '30 days';

-- 4. Were there website_events at that time with no booking link?
--    If yes, the person WAS browsing — we just could not join them.
select visitor_id, event_name, path, created_at
from website_events
where created_at between
      (select created_at - interval '2 hours' from bookings where booking_ref = 'AH-MULFGLQ1-3URW')
  and (select created_at + interval '10 minutes' from bookings where booking_ref = 'AH-MULFGLQ1-3URW')
order by created_at;

-- 5. Volume check — a real scammer/bot rarely books exactly once.
select client_email, count(*) as bookings,
       min(created_at) as first, max(created_at) as last
from bookings
group by client_email
having count(*) > 1
order by count(*) desc;
