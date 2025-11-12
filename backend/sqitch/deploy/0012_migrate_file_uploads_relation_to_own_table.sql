-- Deploy erato:0012_migrate_file_uploads_relation_to_own_table to pg

BEGIN;

-- Create chat_file_uploads join table
CREATE TABLE public.chat_file_uploads (
    chat_id uuid NOT NULL,
    file_upload_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add primary key constraint (composite key)
ALTER TABLE ONLY public.chat_file_uploads
    ADD CONSTRAINT chat_file_uploads_pkey PRIMARY KEY (chat_id, file_upload_id);

-- Add foreign key constraint to chats
ALTER TABLE ONLY public.chat_file_uploads
    ADD CONSTRAINT chat_file_uploads_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;

-- Add foreign key constraint to file_uploads
ALTER TABLE ONLY public.chat_file_uploads
    ADD CONSTRAINT chat_file_uploads_file_upload_id_fkey FOREIGN KEY (file_upload_id) REFERENCES public.file_uploads(id) ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX idx_chat_file_uploads_chat_id ON public.chat_file_uploads USING btree (chat_id);
CREATE INDEX idx_chat_file_uploads_file_upload_id ON public.chat_file_uploads USING btree (file_upload_id);

-- Add updated_at trigger
CREATE TRIGGER on_update_set_updated_columns_chat_file_uploads BEFORE UPDATE ON public.chat_file_uploads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- Migrate existing data from file_uploads.chat_id to the new join table
INSERT INTO public.chat_file_uploads (chat_id, file_upload_id, created_at, updated_at)
SELECT
    fu.chat_id,
    fu.id,
    fu.created_at,
    fu.updated_at
FROM public.file_uploads fu
WHERE fu.chat_id IS NOT NULL;

-- Now remove the foreign key constraint from file_uploads
ALTER TABLE public.file_uploads DROP CONSTRAINT IF EXISTS file_uploads_chat_id_fkey;

-- Drop the chat_id column entirely since relations are now managed by the join table
ALTER TABLE public.file_uploads DROP COLUMN IF EXISTS chat_id;

COMMIT;
