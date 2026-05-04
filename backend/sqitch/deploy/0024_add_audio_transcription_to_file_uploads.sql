-- Deploy erato:0024_add_audio_transcription_to_file_uploads to pg

BEGIN;

ALTER TABLE public.file_uploads
    ADD COLUMN audio_transcription text;

COMMIT;
