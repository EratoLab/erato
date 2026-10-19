-- Verify erato:0060_add_teams_transcript_to_file_uploads on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'file_uploads'
  AND column_name = 'teams_transcript'
  AND data_type = 'jsonb'
  AND is_nullable = 'YES';

ROLLBACK;
