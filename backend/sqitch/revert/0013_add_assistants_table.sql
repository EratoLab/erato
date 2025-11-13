-- Revert erato:0013_add_assistants_table from pg

BEGIN;

-- Drop assistant_file_uploads join table
DROP TABLE public.assistant_file_uploads;

-- Remove assistant_configuration column and generated assistant_id column from chats table
ALTER TABLE public.chats DROP COLUMN IF EXISTS assistant_configuration;
ALTER TABLE public.chats DROP COLUMN IF EXISTS assistant_id;

-- Drop assistants table
DROP TABLE public.assistants;

COMMIT;
