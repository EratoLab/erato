-- Verify erato:0072_add_wait_lines_preference on pg

BEGIN;

SELECT wait_lines_amount FROM public.user_preferences WHERE FALSE;

ROLLBACK;
