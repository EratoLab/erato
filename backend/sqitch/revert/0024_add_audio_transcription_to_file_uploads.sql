-- Revert erato:0024_add_audio_transcription_to_file_uploads from pg

BEGIN;

ALTER TABLE public.file_uploads
    DROP COLUMN IF EXISTS audio_transcription;

COMMIT;
