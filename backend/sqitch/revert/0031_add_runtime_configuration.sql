-- Revert erato:0031_add_runtime_configuration from pg

BEGIN;

DROP TABLE public.runtime_configuration;

COMMIT;
