-- Revert erato:0006_add_chats_summary_and_archived from pg

BEGIN;

-- Drop the columns added in the deploy script
ALTER TABLE public.chats DROP COLUMN title_by_summary;
ALTER TABLE public.chats DROP COLUMN archived_at;

COMMIT;
