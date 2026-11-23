-- Deploy erato:0076_add_spoken_preferences to pg
-- requires: 0075_add_reply_speech_show_in_chat_preference

BEGIN;

-- Whether replies are spoken and approval cards read aloud in conversation.
-- NULL follows the organisation's setting; a value is used only where the
-- user may choose.
ALTER TABLE public.user_preferences
    ADD COLUMN reply_speech_spoken boolean,
    ADD COLUMN approval_speech_spoken boolean;

COMMIT;
