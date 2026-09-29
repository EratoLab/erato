-- Revert erato:0054_add_chat_created_via from pg

BEGIN;

ALTER TABLE public.chats
    DROP COLUMN created_via;

COMMIT;
