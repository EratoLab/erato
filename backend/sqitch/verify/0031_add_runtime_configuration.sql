-- Verify erato:0031_add_runtime_configuration on pg

BEGIN;

SELECT
    id,
    source_service,
    source_filename,
    config,
    created_at,
    updated_at
FROM public.runtime_configuration
WHERE FALSE;

ROLLBACK;
