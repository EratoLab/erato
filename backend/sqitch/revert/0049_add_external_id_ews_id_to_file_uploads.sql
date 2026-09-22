-- Revert erato:0049_add_external_id_ews_id_to_file_uploads from pg

BEGIN;

ALTER TABLE public.file_uploads
    DROP COLUMN IF EXISTS external_id_ews_id;

COMMIT;
