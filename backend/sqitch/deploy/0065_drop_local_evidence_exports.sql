-- Deploy erato:0065_drop_local_evidence_exports to pg
-- requires: 0064_add_client_operation_claimant

BEGIN;

-- The table held signed plans and receipts for the local-evidence operation,
-- which no longer exists. Nothing reads or writes it.
DROP TABLE public.local_evidence_exports;

COMMIT;
