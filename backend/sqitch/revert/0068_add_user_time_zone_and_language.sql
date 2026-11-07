-- Revert erato:0068_add_user_time_zone_and_language from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN time_zone,
    DROP COLUMN language;

COMMIT;
