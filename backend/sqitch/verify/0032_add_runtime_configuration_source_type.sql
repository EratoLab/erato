-- Verify erato:0032_add_runtime_configuration_source_type on pg

BEGIN;

SELECT
    id,
    source_service,
    source_type,
    source_filename,
    config,
    created_at,
    updated_at
FROM public.runtime_configuration
WHERE FALSE;

ROLLBACK;
