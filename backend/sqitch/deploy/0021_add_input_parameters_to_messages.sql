-- Deploy erato:0021_add_input_parameters_to_messages to pg

BEGIN;

-- Stores user-provided input context alongside the message, such as action facet
-- payloads (selected text, source property). Semantically distinct from
-- generation_parameters which records how the assistant response was produced.
ALTER TABLE public.messages
    ADD COLUMN input_parameters jsonb;

COMMIT;
