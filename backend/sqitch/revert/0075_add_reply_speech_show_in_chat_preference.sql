-- Revert erato:0075_add_reply_speech_show_in_chat_preference from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN reply_speech_show_in_chat;

COMMIT;
