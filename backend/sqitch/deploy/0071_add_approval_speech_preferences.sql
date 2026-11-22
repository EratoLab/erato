-- Deploy erato:0071_add_approval_speech_preferences to pg
-- requires: 0070_add_excel_and_powerpoint_created_via

BEGIN;

-- How the user wants waiting approval cards read aloud in conversational
-- audio mode: how much is said and how it is worded. NULL follows the
-- organisation's setting; a value is used only where the user may choose.
ALTER TABLE public.user_preferences
    ADD COLUMN approval_speech_amount text,
    ADD COLUMN approval_speech_wording text,
    ADD CONSTRAINT user_preferences_approval_speech_amount_check
        CHECK (approval_speech_amount = ANY (ARRAY['full'::text, 'short'::text])),
    ADD CONSTRAINT user_preferences_approval_speech_wording_check
        CHECK (approval_speech_wording = ANY (ARRAY['precise'::text, 'natural'::text]));

COMMIT;
