-- Deploy erato:0016_add_title_by_user_provided_to_chats to pg

BEGIN;

-- Add optional user-specified display name for chats.
ALTER TABLE public.chats ADD COLUMN title_by_user_provided text DEFAULT NULL;

COMMIT;
