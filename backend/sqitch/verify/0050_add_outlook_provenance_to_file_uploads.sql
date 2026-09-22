-- Verify erato:0050_add_outlook_provenance_to_file_uploads on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'file_uploads'
  AND column_name = 'outlook_provenance'
  AND data_type = 'jsonb'
  AND is_nullable = 'YES';

ROLLBACK;
