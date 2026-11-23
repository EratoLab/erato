-- Revert erato:0076_add_spoken_preferences from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN reply_speech_spoken,
    DROP COLUMN approval_speech_spoken;

COMMIT;
