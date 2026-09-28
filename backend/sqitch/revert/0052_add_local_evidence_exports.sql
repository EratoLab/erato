-- Revert erato:0052_add_local_evidence_exports from pg
BEGIN;
DROP TABLE public.local_evidence_exports;
COMMIT;
