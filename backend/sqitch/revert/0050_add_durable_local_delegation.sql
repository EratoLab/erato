-- Revert erato:0050_add_durable_local_delegation from pg
BEGIN;
DROP TABLE public.local_delegation_jobs;
COMMIT;
