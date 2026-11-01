-- Verify erato:0064_add_client_operation_claimant on pg

BEGIN;

SELECT claim_claimant FROM public.client_operation_attempts WHERE false;

ROLLBACK;
