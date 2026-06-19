-- Verify erato:0025_add_chat_title_search_index on pg

BEGIN;

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chats'
  AND indexname = 'idx_chats_resolved_title_search';

ROLLBACK;
