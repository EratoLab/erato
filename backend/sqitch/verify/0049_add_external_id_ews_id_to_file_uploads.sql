-- Verify erato:0049_add_external_id_ews_id_to_file_uploads on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'file_uploads'
  AND column_name = 'external_id_ews_id'
  AND data_type = 'text'
  AND is_nullable = 'YES';

ROLLBACK;
