BEGIN;
ALTER TABLE file_uploads ADD COLUMN audio_synthesis jsonb;
COMMIT;
