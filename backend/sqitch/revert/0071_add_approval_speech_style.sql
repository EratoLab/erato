-- Revert erato:0071_add_approval_speech_style from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN approval_speech_style;

COMMIT;
