-- Revert erato:0064_add_client_operation_claimant from pg

BEGIN;

ALTER TABLE public.client_operation_attempts DROP COLUMN claim_claimant;

COMMIT;
