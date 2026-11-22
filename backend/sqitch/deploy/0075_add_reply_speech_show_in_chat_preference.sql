-- Deploy erato:0075_add_reply_speech_show_in_chat_preference to pg
-- requires: 0074_add_reply_speech_preference

BEGIN;

-- Whether the chat shows what the voice said in conversation. NULL follows
-- the organisation's setting; a value is used only where the user may choose.
ALTER TABLE public.user_preferences
    ADD COLUMN reply_speech_show_in_chat boolean;

COMMIT;
