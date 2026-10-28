-- Revert erato:0063_add_executor_stream_instances from pg

BEGIN;

ALTER TABLE public.client_executor_presence
    DROP COLUMN connected_at,
    DROP COLUMN instance_id;

COMMIT;
