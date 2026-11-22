-- Verify erato:0073_add_voice_decision_receipts on pg

BEGIN;

SELECT id, user_id, message_id, approval_id, card_digest, outcome, record, created_at, expires_at
FROM public.voice_decision_receipts WHERE FALSE;

ROLLBACK;
