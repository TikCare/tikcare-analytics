-- 05: events_daily rollup + 90-day raw retention (pg_cron)
--
-- Why: `events` only ever grows — every click/exposure/page view is one row,
-- and with autocapture v1.6.0 (allClickables + views:'all') exposure volume
-- is ~5-10x click volume. This keeps raw rows for 90 days (per-event
-- reconstruction stays possible) and compacts everything older into a daily
-- aggregate (~1% the size) that still answers "which button / which page /
-- how many" for long-term trends.
--
-- How to apply: paste this whole file into the TC_EVENT_TRACKER
-- (rqsmiovhqurvafmqvkro) SQL editor and run once. Idempotent-ish: the
-- extension/table/index steps are IF NOT EXISTS; re-running the backfill or
-- re-scheduling the job WILL duplicate rows / error on a duplicate jobname —
-- check `select * from cron.job;` first if unsure.
--
-- Applied to TC_EVENT_TRACKER: 2026-09-03. Verified: cron.job active, backfill
-- sum(n)=4862 == raw rows before that day (exact), RLS enabled on events_daily.

-- 1) pg_cron: in-database scheduler (was not enabled on this project).
create extension if not exists pg_cron;

-- 2) The daily aggregate. No PK on purpose — the grain is the GROUP BY of
--    the rollup insert (day, app_id, environment, event_name, element_id,
--    page_path), and element_id/page_path are nullable, which a PK can't hold.
create table if not exists events_daily (
  day         date   not null,
  app_id      text   not null,
  environment text,
  event_name  text   not null,
  element_id  text,
  page_path   text,
  n           bigint not null
);
create index if not exists events_daily_day_app on events_daily (day, app_id);

-- 3) One-time backfill: aggregate every full day before today (UTC). NOTE:
--    the first nightly run WILL re-process the last backfilled day (see the
--    timezone note in step 4) — harmless now that the job deletes its target
--    day first, but this is why 2026-09-02 was doubled on the first night.
insert into events_daily
select occurred_at::date, app_id, environment, event_name, element_id, page_path, count(*)
from events
where occurred_at < now()::date
group by 1, 2, 3, 4, 5, 6;

-- 4) Nightly at 19:00 UTC (= 03:00 HKT): aggregate "yesterday" — in UTC
--    terms, then drop raw rows older than 90 days. Timezone reality check
--    (learned on the first night, 2026-09-03 19:00 UTC): now()::date is UTC,
--    so at 19:00 UTC on day D this window is day D-1 — the very day the
--    same-day backfill already covered, which doubled 2026-09-02 (886 rolled
--    vs 443 raw; rebuilt by hand 2026-09-04). The leading DELETE makes the
--    job idempotent so an overlap or manual rerun can never double a day
--    again. Also note each UTC day lands ~19h after it ends (day D at 19:00
--    UTC on D+1), so max(day) trails the calendar by design.
select cron.schedule('events-rollup-purge', '0 19 * * *', $$
  delete from events_daily where day = (now() - interval '1 day')::date;
  insert into events_daily
  select occurred_at::date, app_id, environment, event_name, element_id, page_path, count(*)
  from events
  where occurred_at >= (now() - interval '1 day')::date
    and occurred_at <  now()::date
  group by 1, 2, 3, 4, 5, 6;
  delete from events where occurred_at < now() - interval '90 days';
$$);

-- 5) Verify: expect one active job and a populated aggregate.
select jobid, jobname, schedule, active from cron.job;
select count(*) as daily_rows, min(day) as first_day, max(day) as last_day from events_daily;
