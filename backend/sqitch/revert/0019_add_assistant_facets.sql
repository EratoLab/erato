-- Revert erato:0019_add_assistant_facets from pg

BEGIN;

ALTER TABLE public.assistants
    DROP COLUMN enforce_facet_settings,
    DROP COLUMN facet_ids;

COMMIT;
