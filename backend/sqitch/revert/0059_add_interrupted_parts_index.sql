-- Revert erato:0059_add_interrupted_parts_index from pg

BEGIN;
DROP INDEX public.idx_messages_interrupted_parts;
COMMIT;
