-- Verify erato:0018_add_owner_user_id_to_file_uploads on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'file_uploads'
  AND column_name = 'owner_user_id'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'file_uploads'
  AND indexname = 'idx_file_uploads_owner_user_id';

ROLLBACK;
