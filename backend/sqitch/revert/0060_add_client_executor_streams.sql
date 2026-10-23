-- Revert erato:0060_add_client_executor_streams from pg

BEGIN;

DROP TABLE public.client_executor_calls;
DROP TABLE public.client_executor_presence;

COMMIT;
