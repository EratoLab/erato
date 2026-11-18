-- Verify erato:0071_add_approval_speech_style on pg

BEGIN;

SELECT approval_speech_style FROM public.user_preferences WHERE FALSE;

ROLLBACK;
