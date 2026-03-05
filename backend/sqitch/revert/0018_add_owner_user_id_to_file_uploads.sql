-- Revert erato:0018_add_owner_user_id_to_file_uploads from pg

BEGIN;

DROP INDEX IF EXISTS public.idx_file_uploads_owner_user_id;

ALTER TABLE public.file_uploads
    DROP COLUMN IF EXISTS owner_user_id;

COMMIT;
