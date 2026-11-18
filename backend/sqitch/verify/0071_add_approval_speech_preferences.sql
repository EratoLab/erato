-- Verify erato:0071_add_approval_speech_preferences on pg

BEGIN;

SELECT approval_speech_amount, approval_speech_wording FROM public.user_preferences WHERE FALSE;

ROLLBACK;
