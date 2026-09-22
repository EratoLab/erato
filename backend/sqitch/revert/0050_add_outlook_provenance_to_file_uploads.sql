-- Revert erato:0050_add_outlook_provenance_to_file_uploads from pg

BEGIN;

ALTER TABLE public.file_uploads DROP COLUMN outlook_provenance;

COMMIT;
