-- ChoreSync — schedule the reminder job
-- Run this AFTER you have deployed the send-reminders Edge Function.
-- Replace the two placeholders below first:
--   <PROJECT_REF>       -> your project ref (in your Supabase URL: https://<PROJECT_REF>.supabase.co)
--   <SERVICE_ROLE_KEY>  -> Dashboard -> Project Settings -> API -> service_role key (keep secret)

-- Runs every 5 minutes; the function itself decides if a reminder is actually due.
select cron.schedule(
  'choresync-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/send-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Handy management commands:
--   select * from cron.job;                          -- list jobs
--   select cron.unschedule('choresync-reminders');   -- remove the job
