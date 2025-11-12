-- Revert erato:0012_migrate_file_uploads_relation_to_own_table from pg

BEGIN;

-- Add back the chat_id column to file_uploads table
ALTER TABLE public.file_uploads ADD COLUMN chat_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- First, migrate data back from join table to file_uploads.chat_id
UPDATE public.file_uploads fu
SET chat_id = cfu.chat_id
FROM public.chat_file_uploads cfu
WHERE fu.id = cfu.file_upload_id;

-- Remove the default value after data migration
ALTER TABLE public.file_uploads ALTER COLUMN chat_id DROP DEFAULT;

-- Add back the foreign key constraint
ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id);

-- Drop the join table
DROP TABLE public.chat_file_uploads;

COMMIT;
