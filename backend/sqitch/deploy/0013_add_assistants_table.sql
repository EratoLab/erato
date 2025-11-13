-- Deploy erato:0013_add_assistants_table to pg

BEGIN;

-- Create assistants table
CREATE TABLE public.assistants (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    prompt text NOT NULL,
    mcp_server_ids text[], -- Array of MCP server IDs available to the assistant
    default_chat_provider text, -- Default chat provider/model ID for the assistant
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add primary key constraint
ALTER TABLE ONLY public.assistants
    ADD CONSTRAINT assistants_pkey PRIMARY KEY (id);

-- Add foreign key constraint to users (owner_user_id references users.id)
ALTER TABLE ONLY public.assistants
    ADD CONSTRAINT assistants_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Add index on owner_user_id for efficient queries
CREATE INDEX idx_assistants_owner_user_id ON public.assistants USING btree (owner_user_id);

-- Add index on updated_at for sorting
CREATE INDEX idx_assistants_updated_at ON public.assistants USING btree (updated_at DESC);

-- Add index on archived_at for filtering non-archived assistants
CREATE INDEX idx_assistants_archived_at ON public.assistants USING btree (archived_at);

-- Add updated_at trigger
CREATE TRIGGER on_update_set_updated_columns_assistants BEFORE UPDATE ON public.assistants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- Add assistant_configuration column to chats table
ALTER TABLE public.chats ADD COLUMN assistant_configuration jsonb DEFAULT NULL;

-- Add a generated column that extracts the assistant_id from JSON for foreign key constraint
ALTER TABLE public.chats ADD COLUMN assistant_id uuid
    GENERATED ALWAYS AS ((assistant_configuration->>'assistant_id')::uuid) STORED;

-- Add index on assistant_configuration for efficient queries
CREATE INDEX idx_chats_assistant_configuration ON public.chats USING btree ((assistant_configuration->>'assistant_id'));

-- Add foreign key constraint from generated assistant_id column to assistants table
ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_assistant_id_fkey FOREIGN KEY (assistant_id) REFERENCES public.assistants(id);

-- Create assistant_file_uploads join table for default files associated with assistants
CREATE TABLE public.assistant_file_uploads (
    assistant_id uuid NOT NULL,
    file_upload_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add primary key constraint (composite key)
ALTER TABLE ONLY public.assistant_file_uploads
    ADD CONSTRAINT assistant_file_uploads_pkey PRIMARY KEY (assistant_id, file_upload_id);

-- Add foreign key constraint to assistants
ALTER TABLE ONLY public.assistant_file_uploads
    ADD CONSTRAINT assistant_file_uploads_assistant_id_fkey FOREIGN KEY (assistant_id) REFERENCES public.assistants(id) ON DELETE CASCADE;

-- Add foreign key constraint to file_uploads
ALTER TABLE ONLY public.assistant_file_uploads
    ADD CONSTRAINT assistant_file_uploads_file_upload_id_fkey FOREIGN KEY (file_upload_id) REFERENCES public.file_uploads(id) ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX idx_assistant_file_uploads_assistant_id ON public.assistant_file_uploads USING btree (assistant_id);
CREATE INDEX idx_assistant_file_uploads_file_upload_id ON public.assistant_file_uploads USING btree (file_upload_id);

-- Add updated_at trigger
CREATE TRIGGER on_update_set_updated_columns_assistant_file_uploads BEFORE UPDATE ON public.assistant_file_uploads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
