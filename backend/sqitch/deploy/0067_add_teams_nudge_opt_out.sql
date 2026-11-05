-- Deploy erato:0067_add_teams_nudge_opt_out to pg
-- requires: 0066_add_scheduled_deliveries

BEGIN;

-- When the user asked the Teams bot to stop sending tips (card button or
-- `/reminders off`); NULL means tips are welcome.
ALTER TABLE public.user_preferences ADD COLUMN teams_nudges_opted_out_at timestamptz;

COMMIT;
