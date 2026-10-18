-- Verify erato:0059_add_interrupted_parts_index on pg

BEGIN;
SELECT 1 / count(*)
FROM pg_index
WHERE indexrelid = 'public.idx_messages_interrupted_parts'::regclass
  AND indrelid = 'public.messages'::regclass
  AND indisvalid AND indisready AND indpred IS NOT NULL;
ROLLBACK;
