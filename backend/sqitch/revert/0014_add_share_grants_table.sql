-- Revert erato:0014_add_share_grants_table from pg

BEGIN;

-- Drop share_grants table (cascades to remove all constraints and indexes)
DROP TABLE public.share_grants;

COMMIT;
