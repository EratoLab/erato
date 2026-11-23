-- Verify erato:0076_add_spoken_preferences on pg

BEGIN;

SELECT reply_speech_spoken, approval_speech_spoken FROM public.user_preferences WHERE FALSE;

ROLLBACK;
