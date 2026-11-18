-- Revert erato:0071_add_approval_speech_preferences from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN approval_speech_amount,
    DROP COLUMN approval_speech_wording;

COMMIT;
