-- Deploy erato:0006_add_chats_summary_and_archived to pg

BEGIN;

-- Add title_by_summary column to chats table
ALTER TABLE public.chats ADD COLUMN title_by_summary text DEFAULT NULL;

-- Add archived_at column to chats table
ALTER TABLE public.chats ADD COLUMN archived_at timestamp with time zone DEFAULT NULL;

COMMIT;
