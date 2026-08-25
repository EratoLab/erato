-- Verify erato:0038_add_default_chat_provider_to_user_preferences on pg

BEGIN;

SELECT default_chat_provider
FROM public.user_preferences
WHERE FALSE;

ROLLBACK;
