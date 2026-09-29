-- Revert erato:0053_add_ms_teams_bot from pg
BEGIN;
DROP TABLE public.ms_teams_token_exchanges;
DROP TABLE public.ms_teams_conversations;
DROP INDEX public.users_entra_object_id_unique;
ALTER TABLE public.users DROP COLUMN entra_object_id;
COMMIT;
