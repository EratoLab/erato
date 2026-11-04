-- Verify erato:0065_drop_local_evidence_exports on pg

BEGIN;

SELECT 1 / (to_regclass('public.local_evidence_exports') IS NULL)::int;

ROLLBACK;
