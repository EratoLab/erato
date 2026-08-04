-- Revert erato:0032_add_runtime_configuration_source_type from pg

BEGIN;

ALTER TABLE public.runtime_configuration
    DROP COLUMN source_type;

COMMIT;
