-- Revert erato:0056_add_ms_teams_pending_sign_ins from pg
BEGIN;
DROP TABLE public.ms_teams_pending_sign_ins;
COMMIT;
