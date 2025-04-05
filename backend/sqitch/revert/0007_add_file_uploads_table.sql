-- Revert erato:0007_add_file_uploads_table from pg

BEGIN;

-- Drop input_file_uploads column from messages table
ALTER TABLE public.messages DROP COLUMN input_file_uploads;

-- Drop file_uploads table
DROP TABLE public.file_uploads;

COMMIT;
