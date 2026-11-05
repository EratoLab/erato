-- Revert erato:0067_add_teams_nudge_opt_out from pg

BEGIN;

ALTER TABLE public.user_preferences DROP COLUMN teams_nudges_opted_out_at;

COMMIT;
