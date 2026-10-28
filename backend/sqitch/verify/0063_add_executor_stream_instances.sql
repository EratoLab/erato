-- Verify erato:0063_add_executor_stream_instances on pg

BEGIN;

SELECT instance_id, connected_at FROM public.client_executor_presence WHERE false;

ROLLBACK;
