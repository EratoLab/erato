-- Verify erato:0035_add_pinned_chats on pg

BEGIN;

SELECT is_pinned
FROM public.chats
WHERE FALSE;

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chats'
  AND indexname = 'idx_chats_owner_user_id_is_pinned';

ROLLBACK;
