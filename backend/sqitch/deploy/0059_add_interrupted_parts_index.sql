-- Deploy erato:0059_add_interrupted_parts_index to pg

BEGIN;

-- Matches the literal scan predicate even for generic prepared plans.
-- Only unresolved tool messages occupy the index; completed history does not.
-- Do not INCLUDE raw_message: it can be large and is read only for candidates.
-- This transactional build scans history once and blocks writes while building.
-- Schedule deployment in a maintenance window on large installations.
CREATE INDEX idx_messages_interrupted_parts
    ON public.messages (updated_at)
    WHERE raw_message -> 'content'
        @> '[{"content_type":"tool_use","status":"in_progress"}]'::jsonb;

COMMIT;
