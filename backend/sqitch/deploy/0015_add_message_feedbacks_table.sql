-- Deploy erato:0015_add_message_feedbacks_table to pg

BEGIN;

-- Create message_feedbacks table
CREATE TABLE public.message_feedbacks (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    message_id uuid NOT NULL,
    sentiment text NOT NULL CHECK (sentiment IN ('positive', 'negative')),
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add primary key constraint
ALTER TABLE ONLY public.message_feedbacks
    ADD CONSTRAINT message_feedbacks_pkey PRIMARY KEY (id);

-- Add foreign key constraint to messages table
ALTER TABLE ONLY public.message_feedbacks
    ADD CONSTRAINT message_feedbacks_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

-- Add unique constraint to ensure only one feedback per message
ALTER TABLE ONLY public.message_feedbacks
    ADD CONSTRAINT message_feedbacks_unique_message UNIQUE (message_id);

-- Add index on message_id for efficient lookup
CREATE INDEX idx_message_feedbacks_message_id ON public.message_feedbacks USING btree (message_id);

-- Add index on created_at for sorting
CREATE INDEX idx_message_feedbacks_created_at ON public.message_feedbacks USING btree (created_at DESC);

-- Add updated_at trigger
CREATE TRIGGER on_update_set_updated_columns_message_feedbacks BEFORE UPDATE ON public.message_feedbacks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
