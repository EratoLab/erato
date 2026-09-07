BEGIN;
SELECT 1 / COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_chats_assistant_usage';
SELECT 1 / COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_messages_assistant_usage';
ROLLBACK;
