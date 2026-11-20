-- Deploy erato:0072_add_wait_lines_preference to pg
-- requires: 0071_add_approval_speech_preferences

BEGIN;

-- What the voice says while the user waits for an answer in conversational
-- audio mode. NULL follows the organisation's setting; a value is used only
-- where the user may choose.
ALTER TABLE public.user_preferences
    ADD COLUMN wait_lines_amount text,
    ADD CONSTRAINT user_preferences_wait_lines_amount_check
        CHECK (wait_lines_amount = ANY (ARRAY['normal'::text, 'long_only'::text, 'off'::text]));

COMMIT;
