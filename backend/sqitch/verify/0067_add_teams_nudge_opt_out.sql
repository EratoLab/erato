-- Verify erato:0067_add_teams_nudge_opt_out on pg

BEGIN;

SELECT teams_nudges_opted_out_at FROM public.user_preferences WHERE FALSE;

ROLLBACK;
