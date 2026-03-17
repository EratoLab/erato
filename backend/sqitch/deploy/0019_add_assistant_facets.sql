-- Deploy erato:0019_add_assistant_facets to pg

BEGIN;

ALTER TABLE public.assistants
    ADD COLUMN facet_ids text[],
    ADD COLUMN enforce_facet_settings boolean DEFAULT false NOT NULL;

COMMIT;
