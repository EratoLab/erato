-- Verify erato:0019_add_assistant_facets on pg

BEGIN;

SELECT facet_ids, enforce_facet_settings
FROM public.assistants
WHERE FALSE;

ROLLBACK;
