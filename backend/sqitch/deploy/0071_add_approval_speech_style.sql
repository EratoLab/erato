-- Deploy erato:0071_add_approval_speech_style to pg
-- requires: 0070_add_excel_and_powerpoint_created_via

BEGIN;

-- How the user wants waiting approval cards read aloud in conversational
-- audio mode: `precise` or `natural`. NULL follows the organisation's
-- `[approval_speech] style`; a value is ignored while the organisation does
-- not let users choose.
ALTER TABLE public.user_preferences
    ADD COLUMN approval_speech_style text,
    ADD CONSTRAINT user_preferences_approval_speech_style_check
        CHECK (approval_speech_style = ANY (ARRAY['precise'::text, 'natural'::text]));

COMMIT;
