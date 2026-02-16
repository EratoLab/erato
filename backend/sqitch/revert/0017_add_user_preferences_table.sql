-- Revert erato:0017_add_user_preferences_table from pg

BEGIN;

DROP TABLE public.user_preferences;

COMMIT;
