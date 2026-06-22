-- Deploy erato:0026_add_assistant_store_tables to pg

BEGIN;

CREATE TABLE public.assistant_store_assistants (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    source_assistant_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.assistant_store_assistants
    ADD CONSTRAINT assistant_store_assistants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assistant_store_assistants
    ADD CONSTRAINT assistant_store_assistants_source_assistant_id_key UNIQUE (source_assistant_id);

ALTER TABLE ONLY public.assistant_store_assistants
    ADD CONSTRAINT assistant_store_assistants_source_assistant_id_fkey FOREIGN KEY (source_assistant_id) REFERENCES public.assistants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assistant_store_assistants
    ADD CONSTRAINT assistant_store_assistants_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX idx_assistant_store_assistants_owner_user_id ON public.assistant_store_assistants USING btree (owner_user_id);

CREATE TRIGGER on_update_set_updated_columns_assistant_store_assistants BEFORE UPDATE ON public.assistant_store_assistants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

CREATE TABLE public.assistant_store_assistant_versions (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    assistant_store_assistant_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    status text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    is_current_published_version boolean DEFAULT false NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    version_number text NOT NULL,
    version_comment text,
    creator_review_comment text,
    reviewer_review_comment text,
    long_description text NOT NULL,
    category_ids text[],
    keywords text[],
    diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_store_assistant_versions_status_check CHECK (status IN ('submitted', 'review_accepted', 'review_declined', 'withdrawn')),
    CONSTRAINT assistant_store_assistant_versions_published_status_check CHECK ((NOT is_published) OR status = 'review_accepted'),
    CONSTRAINT assistant_store_assistant_versions_current_published_check CHECK ((NOT is_current_published_version) OR (is_published AND status = 'review_accepted'))
);

ALTER TABLE ONLY public.assistant_store_assistant_versions
    ADD CONSTRAINT assistant_store_assistant_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assistant_store_assistant_versions
    ADD CONSTRAINT assistant_store_assistant_versions_assistant_id_key UNIQUE (assistant_id);

ALTER TABLE ONLY public.assistant_store_assistant_versions
    ADD CONSTRAINT assistant_store_assistant_versions_store_assistant_id_fkey FOREIGN KEY (assistant_store_assistant_id) REFERENCES public.assistant_store_assistants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assistant_store_assistant_versions
    ADD CONSTRAINT assistant_store_assistant_versions_assistant_id_fkey FOREIGN KEY (assistant_id) REFERENCES public.assistants(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_assistant_store_versions_current
    ON public.assistant_store_assistant_versions USING btree (assistant_store_assistant_id)
    WHERE is_current_published_version;

CREATE INDEX idx_assistant_store_versions_store_assistant_id ON public.assistant_store_assistant_versions USING btree (assistant_store_assistant_id);
CREATE INDEX idx_assistant_store_versions_status ON public.assistant_store_assistant_versions USING btree (status);
CREATE INDEX idx_assistant_store_versions_published ON public.assistant_store_assistant_versions USING btree (is_published, is_current_published_version);
CREATE INDEX idx_assistant_store_versions_featured ON public.assistant_store_assistant_versions USING btree (featured) WHERE featured;
CREATE INDEX idx_assistant_store_versions_category_ids ON public.assistant_store_assistant_versions USING gin (category_ids);
CREATE INDEX idx_assistant_store_versions_keywords ON public.assistant_store_assistant_versions USING gin (keywords);

CREATE TRIGGER on_update_set_updated_columns_assistant_store_assistant_versions BEFORE UPDATE ON public.assistant_store_assistant_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
