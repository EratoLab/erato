-- Deploy erato:0060_add_teams_transcript_to_file_uploads to pg

BEGIN;

ALTER TABLE public.file_uploads
    ADD COLUMN teams_transcript jsonb;

COMMIT;
