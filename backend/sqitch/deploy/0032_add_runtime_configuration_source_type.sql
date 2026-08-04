-- Deploy erato:0032_add_runtime_configuration_source_type to pg

BEGIN;

ALTER TABLE public.runtime_configuration
    ADD COLUMN source_type text NOT NULL DEFAULT 'erato_toml';

COMMIT;
