-- Verify erato:0039_add_starting_assistant_to_user_preferences on pg

BEGIN;

SELECT starting_hub_assistant_id, starting_assistant_id, starting_assistant_cleared
FROM public.user_preferences
WHERE FALSE;

ROLLBACK;
