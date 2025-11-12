-- Verify erato:0012_migrate_file_uploads_relation_to_own_table on pg

BEGIN;

-- Verify chat_file_uploads table exists
SELECT 1/COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads';

-- Verify table structure
SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads'
  AND column_name = 'chat_id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads'
  AND column_name = 'file_upload_id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads'
  AND column_name = 'created_at'
  AND data_type = 'timestamp with time zone'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads'
  AND column_name = 'updated_at'
  AND data_type = 'timestamp with time zone'
  AND is_nullable = 'NO';

-- Verify primary key constraint exists
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads'
  AND constraint_name = 'chat_file_uploads_pkey'
  AND constraint_type = 'PRIMARY KEY';

-- Verify foreign key constraints exist
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads'
  AND constraint_name = 'chat_file_uploads_chat_id_fkey'
  AND constraint_type = 'FOREIGN KEY';

SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'chat_file_uploads'
  AND constraint_name = 'chat_file_uploads_file_upload_id_fkey'
  AND constraint_type = 'FOREIGN KEY';

-- Verify indexes exist
SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chat_file_uploads'
  AND indexname = 'idx_chat_file_uploads_chat_id';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chat_file_uploads'
  AND indexname = 'idx_chat_file_uploads_file_upload_id';

-- Verify trigger exists
SELECT 1/COUNT(*) FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'on_update_set_updated_columns_chat_file_uploads'
  AND event_object_table = 'chat_file_uploads';

-- Verify old foreign key constraint no longer exists
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'file_uploads'
  AND constraint_name = 'file_uploads_chat_id_fkey';

-- Verify chat_id column no longer exists in file_uploads table
SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'file_uploads'
  AND column_name = 'chat_id';

ROLLBACK;
