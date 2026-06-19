-- Revert erato:0025_add_chat_title_search_index from pg

BEGIN;

DROP INDEX IF EXISTS public.idx_chats_resolved_title_search;

COMMIT;
