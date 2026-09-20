-- Verify erato:0047_add_async_delivery_and_latest_generation_indexes on pg

BEGIN;

SELECT 1 / COUNT(*)
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
      'idx_messages_latest_generation',
      'idx_chats_async_delivery_in_flight'
  )
HAVING COUNT(*) = 2;

ROLLBACK;
