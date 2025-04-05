-- Deploy erato:0007_add_file_uploads_table to pg

BEGIN;

-- Create file_uploads table
CREATE TABLE public.file_uploads (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    chat_id uuid NOT NULL,
    filename text NOT NULL,
    file_storage_provider_id text NOT NULL,
    file_storage_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add primary key constraint
ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_pkey PRIMARY KEY (id);

-- Add foreign key constraint to chats
ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id);

-- Add index on chat_id
CREATE INDEX idx_file_uploads_chat_id ON public.file_uploads USING btree (chat_id);

-- Add updated_at trigger
CREATE TRIGGER on_update_set_updated_columns BEFORE UPDATE ON public.file_uploads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- Add input_file_uploads column to messages table
ALTER TABLE public.messages ADD COLUMN input_file_uploads uuid[] DEFAULT NULL;

COMMIT;
