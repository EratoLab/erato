-- Verify erato:0077_add_spoken_languages_preference on pg

BEGIN;

SELECT spoken_languages FROM public.user_preferences WHERE FALSE;

ROLLBACK;
