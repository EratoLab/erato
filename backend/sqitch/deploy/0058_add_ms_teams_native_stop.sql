-- Deploy erato:0058_add_ms_teams_native_stop to pg
BEGIN;
ALTER TABLE public.ms_teams_requests
    ADD COLUMN native_stop_available boolean NOT NULL DEFAULT false;
COMMIT;
