-- Deploy erato:0014_add_share_grants_table to pg

BEGIN;

-- Create share_grants table
CREATE TABLE public.share_grants (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    resource_type text NOT NULL,        -- e.g., 'assistant'
    resource_id text NOT NULL,          -- e.g., assistant UUID
    subject_type text NOT NULL,         -- e.g., 'user'
    subject_id_type text NOT NULL,      -- e.g., 'id' or 'oidc_issuer_and_subject'
    subject_id text NOT NULL,           -- e.g., user UUID or OIDC subject
    role text NOT NULL,                 -- e.g., 'viewer'
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add primary key constraint
ALTER TABLE ONLY public.share_grants
    ADD CONSTRAINT share_grants_pkey PRIMARY KEY (id);

-- Add unique constraint to prevent duplicate share grants
-- A resource can only be shared once with the same subject in the same role
ALTER TABLE ONLY public.share_grants
    ADD CONSTRAINT share_grants_unique_grant UNIQUE (resource_type, resource_id, subject_type, subject_id_type, subject_id, role);

-- Add index on resource for efficient lookup of all shares for a resource
CREATE INDEX idx_share_grants_resource ON public.share_grants USING btree (resource_type, resource_id);

-- Add index on subject for efficient lookup of all shares for a subject
CREATE INDEX idx_share_grants_subject ON public.share_grants USING btree (subject_type, subject_id_type, subject_id);

-- Add index on created_at for sorting
CREATE INDEX idx_share_grants_created_at ON public.share_grants USING btree (created_at DESC);

-- Add updated_at trigger
CREATE TRIGGER on_update_set_updated_columns_share_grants BEFORE UPDATE ON public.share_grants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
