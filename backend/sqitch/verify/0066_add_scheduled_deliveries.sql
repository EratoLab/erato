-- Verify erato:0066_add_scheduled_deliveries on pg

BEGIN;

SELECT id, user_id, kind, due_at, created_by, origin, payload, state,
       claim_token, claimed_at, delivered_at, outcome, dedupe_key,
       created_at, updated_at
FROM public.scheduled_deliveries WHERE FALSE;

ROLLBACK;
