-- Deploy erato:0038_add_default_chat_provider_to_user_preferences to pg

BEGIN;

ALTER TABLE public.user_preferences
    ADD COLUMN default_chat_provider text DEFAULT NULL;

COMMIT;
