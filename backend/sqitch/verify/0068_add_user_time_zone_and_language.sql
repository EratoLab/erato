-- Verify erato:0068_add_user_time_zone_and_language on pg

BEGIN;

SELECT time_zone, language FROM public.user_preferences WHERE FALSE;

ROLLBACK;
