-- Deploy erato:0074_add_reply_speech_preference to pg
-- requires: 0073_add_voice_decision_receipts

BEGIN;

-- How a reply is spoken in conversational audio mode. NULL follows the
-- organisation's setting; a value is used only where the user may choose.
ALTER TABLE public.user_preferences
    ADD COLUMN reply_speech_wording text,
    ADD CONSTRAINT user_preferences_reply_speech_wording_check
        CHECK (reply_speech_wording = ANY (ARRAY['natural'::text, 'precise'::text]));

COMMIT;
