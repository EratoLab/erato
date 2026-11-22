-- Verify erato:0075_add_reply_speech_show_in_chat_preference on pg

BEGIN;

SELECT reply_speech_show_in_chat FROM public.user_preferences WHERE FALSE;

ROLLBACK;
