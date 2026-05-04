-- Verify erato:0024_add_audio_transcription_to_file_uploads on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'file_uploads'
  AND column_name = 'audio_transcription'
  AND data_type = 'text';

ROLLBACK;
