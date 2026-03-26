-- Verify erato:0020_add_share_links_table on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'share_links';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND column_name = 'id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND column_name = 'resource_type'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND column_name = 'resource_id'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND column_name = 'enabled'
  AND data_type = 'boolean'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND column_name = 'created_at'
  AND data_type = 'timestamp with time zone'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND column_name = 'updated_at'
  AND data_type = 'timestamp with time zone'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND constraint_name = 'share_links_pkey'
  AND constraint_type = 'PRIMARY KEY';

SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'share_links'
  AND constraint_name = 'share_links_unique_resource'
  AND constraint_type = 'UNIQUE';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'share_links'
  AND indexname = 'idx_share_links_resource';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'share_links'
  AND indexname = 'idx_share_links_enabled';

SELECT 1/COUNT(*) FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'on_update_set_updated_columns_share_links'
  AND event_object_table = 'share_links';

ROLLBACK;
