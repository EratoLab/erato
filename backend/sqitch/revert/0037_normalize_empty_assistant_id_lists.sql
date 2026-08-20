-- Revert erato:0037_normalize_empty_assistant_id_lists from pg

BEGIN;

-- Data-only normalization: after deploy there is no record of which NULLs
-- were previously empty arrays, and both spellings are intended to mean
-- "no restriction", so there is nothing to restore.

COMMIT;
