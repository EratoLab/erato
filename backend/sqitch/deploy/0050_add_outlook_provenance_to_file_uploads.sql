-- Deploy erato:0050_add_outlook_provenance_to_file_uploads to pg

BEGIN;

ALTER TABLE public.file_uploads
    ADD COLUMN outlook_provenance jsonb;

COMMIT;
