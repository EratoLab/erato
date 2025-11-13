-- Verify erato:0013_add_assistants_table on pg

BEGIN;

-- Verify assistants table exists
SELECT 1/COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'assistants';

-- Verify assistants table structure
SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'owner_user_id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'name'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'description'
  AND data_type = 'text'
  AND is_nullable = 'YES';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'prompt'
  AND data_type = 'text'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'mcp_server_ids'
  AND udt_name = '_text'
  AND is_nullable = 'YES';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'default_chat_provider'
  AND data_type = 'text'
  AND is_nullable = 'YES';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND column_name = 'archived_at'
  AND data_type = 'timestamp with time zone'
  AND is_nullable = 'YES';

-- Verify primary key constraint exists
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND constraint_name = 'assistants_pkey'
  AND constraint_type = 'PRIMARY KEY';

-- Verify foreign key constraint exists
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'assistants'
  AND constraint_name = 'assistants_owner_user_id_fkey'
  AND constraint_type = 'FOREIGN KEY';

-- Verify indexes exist
SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'assistants'
  AND indexname = 'idx_assistants_owner_user_id';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'assistants'
  AND indexname = 'idx_assistants_updated_at';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'assistants'
  AND indexname = 'idx_assistants_archived_at';

-- Verify trigger exists
SELECT 1/COUNT(*) FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'on_update_set_updated_columns_assistants'
  AND event_object_table = 'assistants';

-- Verify assistant_configuration column exists in chats table
SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chats'
  AND column_name = 'assistant_configuration'
  AND data_type = 'jsonb'
  AND is_nullable = 'YES';

-- Verify generated assistant_id column exists in chats table
SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chats'
  AND column_name = 'assistant_id'
  AND data_type = 'uuid'
  AND is_nullable = 'YES'
  AND is_generated = 'ALWAYS'
  AND generation_expression = '((assistant_configuration ->> ''assistant_id''::text))::uuid';

-- Verify index exists for assistant_configuration
SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chats'
  AND indexname = 'idx_chats_assistant_configuration';

-- Verify foreign key constraint exists for assistant_id
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'chats'
  AND constraint_name = 'chats_assistant_id_fkey'
  AND constraint_type = 'FOREIGN KEY';

-- Verify assistant_file_uploads table exists
SELECT 1/COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'assistant_file_uploads';

-- Verify assistant_file_uploads table structure
SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistant_file_uploads'
  AND column_name = 'assistant_id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistant_file_uploads'
  AND column_name = 'file_upload_id'
  AND data_type = 'uuid'
  AND is_nullable = 'NO';

-- Verify assistant_file_uploads primary key constraint exists
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'assistant_file_uploads'
  AND constraint_name = 'assistant_file_uploads_pkey'
  AND constraint_type = 'PRIMARY KEY';

-- Verify assistant_file_uploads foreign key constraints exist
SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'assistant_file_uploads'
  AND constraint_name = 'assistant_file_uploads_assistant_id_fkey'
  AND constraint_type = 'FOREIGN KEY';

SELECT 1/COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'assistant_file_uploads'
  AND constraint_name = 'assistant_file_uploads_file_upload_id_fkey'
  AND constraint_type = 'FOREIGN KEY';

-- Verify assistant_file_uploads indexes exist
SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'assistant_file_uploads'
  AND indexname = 'idx_assistant_file_uploads_assistant_id';

SELECT 1/COUNT(*) FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'assistant_file_uploads'
  AND indexname = 'idx_assistant_file_uploads_file_upload_id';

-- Verify assistant_file_uploads trigger exists
SELECT 1/COUNT(*) FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'on_update_set_updated_columns_assistant_file_uploads'
  AND event_object_table = 'assistant_file_uploads';

ROLLBACK;
