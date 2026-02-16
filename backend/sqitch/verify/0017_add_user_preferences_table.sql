-- Verify erato:0017_add_user_preferences_table on pg

BEGIN;

SELECT
    user_id,
    nickname,
    job_title,
    assistant_custom_instructions,
    assistant_additional_information
FROM public.user_preferences
WHERE FALSE;

ROLLBACK;
