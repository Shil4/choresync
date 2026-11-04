-- ChoreSync — fix: reminders_sent is missing the "slot" column the
-- send-reminders Edge Function relies on for de-duping.
--
-- Without this column, the dedupe query (.eq("slot", k.time)) errors against
-- a column that doesn't exist, so the function can never tell "already sent
-- today" — it just resends the same reminder every 5 minutes (the cron
-- interval) for the rest of the day.
--
-- Run this once in the Supabase SQL editor. Safe to run more than once.

alter table reminders_sent add column if not exists slot text not null default '';

-- Widen the primary key to include slot, so moving a reminder to a new time
-- on the same day is treated as a new slot (and the old one won't collide).
alter table reminders_sent drop constraint if exists reminders_sent_pkey;
alter table reminders_sent add primary key (household_id, sent_date, kind, slot);

-- Optional: clear out any already-stale rows from before this fix so today's
-- reminders aren't accidentally treated as already-sent for the wrong slot.
-- Uncomment if you want a clean slate:
-- delete from reminders_sent where sent_date = current_date;
