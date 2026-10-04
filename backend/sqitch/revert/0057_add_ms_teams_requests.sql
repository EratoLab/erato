-- Revert erato:0057_add_ms_teams_requests from pg
BEGIN;
DROP TABLE public.ms_teams_requests;
COMMIT;
