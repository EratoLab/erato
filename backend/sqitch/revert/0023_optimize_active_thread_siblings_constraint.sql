-- Revert erato:0023_optimize_active_thread_siblings_constraint from pg

BEGIN;

CREATE OR REPLACE FUNCTION public.check_active_thread_siblings_constraint()
RETURNS trigger AS $$
DECLARE
    violation_found boolean;
BEGIN
    -- Check if there are any sibling groups with multiple active messages
    SELECT EXISTS (
        WITH sibling_groups AS (
            -- Find all sibling relationships
            SELECT
                CASE
                    WHEN m1.sibling_message_id IS NOT NULL THEN m1.sibling_message_id
                    ELSE m1.id
                END AS group_id,
                m1.id,
                m1.is_message_in_active_thread
            FROM public.messages m1

            UNION

            SELECT
                CASE
                    WHEN m2.sibling_message_id IS NOT NULL THEN m2.sibling_message_id
                    ELSE m2.id
                END AS group_id,
                m2.id,
                m2.is_message_in_active_thread
            FROM public.messages m2
            WHERE m2.sibling_message_id IS NOT NULL
        ),
        -- Count active messages per group
        active_counts AS (
            SELECT
                group_id,
                SUM(CASE WHEN is_message_in_active_thread THEN 1 ELSE 0 END) AS active_count
            FROM sibling_groups
            GROUP BY group_id
        )
        -- Find groups with more than one active message
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
