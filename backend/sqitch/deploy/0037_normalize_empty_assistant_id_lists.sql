-- Deploy erato:0037_normalize_empty_assistant_id_lists to pg

BEGIN;

-- Generation-time filters treat NULL as "no restriction" but an empty list as
-- "restrict to nothing". The write path now collapses empty lists to NULL, so
-- rows persisted before that change are rewritten to the same spelling; only
-- true empty arrays are touched.
UPDATE public.assistants
SET mcp_server_ids = NULL
WHERE mcp_server_ids IS NOT NULL
  AND cardinality(mcp_server_ids) = 0;

UPDATE public.assistants
SET facet_ids = NULL
WHERE facet_ids IS NOT NULL
  AND cardinality(facet_ids) = 0;

COMMIT;
