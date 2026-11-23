-- Deploy erato:0077_add_spoken_languages_preference to pg
-- requires: 0075_add_reply_speech_show_in_chat_preference

BEGIN;

-- The languages the user speaks, in order, the first being their main
-- language, for the voice in conversational audio mode. NULL follows the
-- user's app language; a value is used only where the user may choose.
ALTER TABLE public.user_preferences
    ADD COLUMN spoken_languages text[],
    ADD CONSTRAINT user_preferences_spoken_languages_check
        CHECK (cardinality(spoken_languages) BETWEEN 1 AND 3);

COMMIT;
