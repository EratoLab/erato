-- Verify erato:0037_normalize_empty_assistant_id_lists on pg

BEGIN;

SELECT 1/COUNT(*)
FROM (
    SELECT 1
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.assistants
        WHERE cardinality(mcp_server_ids) = 0
           OR cardinality(facet_ids) = 0
    )
) AS no_empty_id_lists;

ROLLBACK;
