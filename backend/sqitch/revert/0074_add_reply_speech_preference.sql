-- Revert erato:0074_add_reply_speech_preference from pg

BEGIN;

ALTER TABLE public.user_preferences
    DROP COLUMN reply_speech_wording;

COMMIT;
