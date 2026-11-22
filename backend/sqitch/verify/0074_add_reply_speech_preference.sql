-- Verify erato:0074_add_reply_speech_preference on pg

BEGIN;

SELECT reply_speech_wording FROM public.user_preferences WHERE FALSE;

ROLLBACK;
