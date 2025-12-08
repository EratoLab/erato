-- Verify erato:0014_add_share_grants_table on pg

BEGIN;

-- Verify share_grants table exists
SELECT 1/COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'share_grants';

-- Verify share_grants table structure
SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'resource_type'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'resource_id'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'subject_type'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'subject_id_type'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'subject_id'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'role'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'created_at'
  AND data_type = 'timestamp with time zone'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND column_name = 'updated_at'
  AND data_type = 'timestamp with time zone'
  AND is_nullable = 'NO';

-- Verify primary key constraint exists
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND constraint_name = 'share_grants_pkey'
  AND constraint_type = 'PRIMARY KEY';

-- Verify unique constraint exists
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'share_grants'
  AND constraint_name = 'share_grants_unique_grant'
  AND constraint_type = 'UNIQUE';

-- Verify indexes exist
SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'share_grants'
  AND indexname = 'idx_share_grants_resource';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'share_grants'
  AND indexname = 'idx_share_grants_subject';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'share_grants'
  AND indexname = 'idx_share_grants_created_at';

-- Verify trigger exists
SELECT 1/COUNT(*) FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'on_update_set_updated_columns_share_grants'
  AND event_object_table = 'share_grants';

ROLLBACK;
