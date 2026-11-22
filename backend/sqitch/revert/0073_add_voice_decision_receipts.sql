-- Revert erato:0073_add_voice_decision_receipts from pg

BEGIN;

DROP TABLE public.voice_decision_receipts;

COMMIT;
