-- Revert erato:0009_add_generation_paramters_generation_metadata_columns from pg

BEGIN;

-- Drop generation_parameters and generation_metadata columns from messages table
ALTER TABLE public.messages
    DROP COLUMN generation_parameters,
    DROP COLUMN generation_metadata;

COMMIT;
