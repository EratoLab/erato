-- Revert erato:0058_add_ms_teams_native_stop from pg
BEGIN;
ALTER TABLE public.ms_teams_requests DROP COLUMN native_stop_available;
COMMIT;
