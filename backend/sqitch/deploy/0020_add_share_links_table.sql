-- Deploy erato:0020_add_share_links_table to pg

BEGIN;

CREATE TABLE public.share_links (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.share_links
    ADD CONSTRAINT share_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.share_links
    ADD CONSTRAINT share_links_unique_resource UNIQUE (resource_type, resource_id);

CREATE INDEX idx_share_links_resource ON public.share_links USING btree (resource_type, resource_id);
CREATE INDEX idx_share_links_enabled ON public.share_links USING btree (enabled);

CREATE TRIGGER on_update_set_updated_columns_share_links BEFORE UPDATE ON public.share_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
