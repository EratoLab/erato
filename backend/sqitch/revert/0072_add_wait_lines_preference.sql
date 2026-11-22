-- Revert erato:0072_add_wait_lines_preference from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN wait_lines_amount;

COMMIT;
