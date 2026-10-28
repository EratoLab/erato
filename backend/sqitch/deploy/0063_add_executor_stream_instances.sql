-- Deploy erato:0063_add_executor_stream_instances to pg

BEGIN;

-- A pane sends one instance id for every reconnect of its stream, so a
-- reconnect takes the binding over from that pane's older stream at once,
-- which the server may not see die for minutes.
ALTER TABLE public.client_executor_presence
    ADD COLUMN instance_id uuid DEFAULT NULL,
    ADD COLUMN connected_at timestamptz NOT NULL DEFAULT now();

COMMIT;
