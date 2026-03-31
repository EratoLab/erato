-- Revert erato:0021_add_input_parameters_to_messages from pg

BEGIN;

ALTER TABLE public.messages
    DROP COLUMN input_parameters;

COMMIT;
