-- Revert erato:0036_add_chat_provenance from pg

BEGIN;

DROP INDEX IF EXISTS public.idx_chats_delegated_runs;
DROP INDEX IF EXISTS public.idx_chats_origin_chat_id;
ALTER TABLE public.chats DROP COLUMN origin_chat_id;

COMMIT;
