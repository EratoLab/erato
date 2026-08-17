-- Verify erato:0036_add_chat_provenance on pg

BEGIN;

SELECT origin_chat_id
FROM public.chats
WHERE FALSE;

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chats'
  AND indexname = 'idx_chats_origin_chat_id';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chats'
  AND indexname = 'idx_chats_delegated_runs';

ROLLBACK;
