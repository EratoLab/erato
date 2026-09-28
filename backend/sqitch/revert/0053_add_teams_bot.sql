-- Revert erato:0053_add_teams_bot from pg
BEGIN;
DROP TABLE public.teams_token_exchanges;
DROP TABLE public.teams_conversations;
DROP INDEX public.users_entra_object_id_unique;
ALTER TABLE public.users DROP COLUMN entra_object_id;
COMMIT;
