-- Revert erato:0035_add_pinned_chats from pg

BEGIN;

DROP INDEX IF EXISTS public.idx_chats_owner_user_id_is_pinned;
ALTER TABLE public.chats DROP COLUMN is_pinned;

COMMIT;
