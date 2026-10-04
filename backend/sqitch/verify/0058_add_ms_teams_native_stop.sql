-- Verify erato:0058_add_ms_teams_native_stop on pg
BEGIN;
SELECT native_stop_available FROM public.ms_teams_requests WHERE false;
ROLLBACK;
