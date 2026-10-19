-- Revert erato:0060_add_teams_transcript_to_file_uploads from pg

BEGIN;

ALTER TABLE public.file_uploads DROP COLUMN teams_transcript;

COMMIT;
