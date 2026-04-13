-- Deploy erato:0023_optimize_active_thread_siblings_constraint to pg

BEGIN;

CREATE OR REPLACE FUNCTION public.check_active_thread_siblings_constraint()
RETURNS trigger AS $$
DECLARE
    affected_group_ids uuid[];
    violation_found boolean;
BEGIN
    affected_group_ids := array_remove(
        ARRAY[
            COALESCE(NEW.sibling_message_id, NEW.id),
            CASE
                WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.sibling_message_id, OLD.id)
                ELSE NULL
            END
        ],
        NULL
    );

    -- Only validate the sibling groups touched by this row.
    SELECT EXISTS (
        WITH active_counts AS (
            SELECT
                COALESCE(sibling_message_id, id) AS group_id,
                SUM(CASE WHEN is_message_in_active_thread THEN 1 ELSE 0 END) AS active_count
            FROM public.messages
            WHERE
                id = ANY(affected_group_ids)
                OR sibling_message_id = ANY(affected_group_ids)
            GROUP BY COALESCE(sibling_message_id, id)
        )
        SELECT 1
        FROM active_counts
        WHERE active_count > 1
        LIMIT 1
    ) INTO violation_found;

    IF violation_found THEN
        RAISE EXCEPTION 'Constraint violation: Multiple messages in the same sibling group are marked as active';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
