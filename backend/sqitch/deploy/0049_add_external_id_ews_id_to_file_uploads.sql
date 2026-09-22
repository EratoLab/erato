-- Deploy erato:0049_add_external_id_ews_id_to_file_uploads to pg

BEGIN;

ALTER TABLE public.file_uploads
    ADD COLUMN external_id_ews_id text;

COMMIT;
