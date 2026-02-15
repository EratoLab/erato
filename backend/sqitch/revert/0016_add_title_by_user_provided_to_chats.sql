-- Revert erato:0016_add_title_by_user_provided_to_chats from pg

BEGIN;

ALTER TABLE public.chats DROP COLUMN title_by_user_provided;

COMMIT;
