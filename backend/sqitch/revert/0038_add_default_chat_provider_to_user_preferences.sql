-- Revert erato:0038_add_default_chat_provider_to_user_preferences from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN default_chat_provider;

COMMIT;
