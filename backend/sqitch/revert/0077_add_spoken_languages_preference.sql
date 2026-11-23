-- Revert erato:0077_add_spoken_languages_preference from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN spoken_languages;

COMMIT;
