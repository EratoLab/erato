-- Verify erato:0052_add_local_evidence_exports on pg
BEGIN;
SELECT attempt_id, binding, origin, plan, receipt, export_id, created_at, updated_at
FROM public.local_evidence_exports WHERE FALSE;
ROLLBACK;
