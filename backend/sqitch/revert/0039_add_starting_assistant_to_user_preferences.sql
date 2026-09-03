-- Revert erato:0039_add_starting_assistant_to_user_preferences from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN starting_hub_assistant_id,
    DROP COLUMN starting_assistant_id,
    DROP COLUMN starting_assistant_cleared;

COMMIT;
