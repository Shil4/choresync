-- ChoreSync — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query -> paste -> Run).
-- It is safe to run more than once.

-- 1) Extensions used for the scheduled reminder job -------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Tables -----------------------------------------------------------------

-- One row = your household's shared settings.
create table if not exists household (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Our House',
  members       jsonb not null default '["Dan","Anitta","Shil"]',
  anchor_monday date not null default '2026-07-13',   -- week 1 starts on this Monday
  timezone      text not null default 'Europe/London',
  reminder_day  int  not null default 6,   -- chores; 0=Sun ... 6=Sat
  reminder_time text not null default '10:00',
  bins_out_day  int  not null default 3,   -- Wednesday
  bins_out_time text not null default '18:00',
  bins_in_day   int  not null default 4,   -- Thursday
  bins_in_time  text not null default '18:00',
  pin           text,   -- optional shared PIN gate (blank/null = off)
  updated_at    timestamptz not null default now()
);

-- If the table already existed, make sure the pin column is present:
alter table household add column if not exists pin text;

-- Shared per-week state (what changes week to week and must sync live).
create table if not exists week_state (
  household_id uuid not null references household(id) on delete cascade,
  week_key     text not null,              -- Monday of the week as 'YYYY-MM-DD'
  done         jsonb not null default '{}',   -- {"A:0": true, "B:2": true}
  bins_out     jsonb not null default '[]',   -- ["Person 1"]  (who volunteered)
  bins_in      jsonb not null default '[]',
  updated_at   timestamptz not null default now(),
  primary key (household_id, week_key)
);

-- Web push subscriptions, one per device.
create table if not exists push_subscriptions (
  endpoint     text primary key,
  household_id uuid not null references household(id) on delete cascade,
  person       text,
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);

-- De-dupe guard so a reminder is only sent once per day per kind.
create table if not exists reminders_sent (
  household_id uuid not null,
  sent_date    date not null,
  kind         text not null,   -- 'chore' | 'bins_out' | 'bins_in'
  primary key (household_id, sent_date, kind)
);

-- 3) Row Level Security -----------------------------------------------------
-- Private household app with no login. We allow the anon key to read/write.
-- Anyone with your app URL + anon key could reach the data, which is fine for
-- a 3-person chore list. (You can tighten later with a shared PIN.)
alter table household           enable row level security;
alter table week_state          enable row level security;
alter table push_subscriptions  enable row level security;

drop policy if exists anon_all on household;
create policy anon_all on household           for all using (true) with check (true);
drop policy if exists anon_all on week_state;
create policy anon_all on week_state          for all using (true) with check (true);
drop policy if exists anon_all on push_subscriptions;
create policy anon_all on push_subscriptions  for all using (true) with check (true);

-- 4) Seed the single household row (only if none exists) ---------------------
insert into household (name)
select 'Our House'
where not exists (select 1 from household);

-- 5) Show your household id — copy it into public/config.js ------------------
select id as household_id from household;
