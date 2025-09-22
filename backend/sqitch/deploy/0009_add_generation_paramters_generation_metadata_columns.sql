-- Deploy erato:0009_add_generation_paramters_generation_metadata_columns to pg

BEGIN;

-- Add generation_parameters and generation_metadata JSON columns to messages table
ALTER TABLE public.messages
    ADD COLUMN generation_parameters JSONB,
    ADD COLUMN generation_metadata JSONB;

COMMIT;
