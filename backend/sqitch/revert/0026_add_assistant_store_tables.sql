-- Revert erato:0026_add_assistant_store_tables from pg

BEGIN;

DROP TABLE IF EXISTS public.assistant_store_assistant_versions;
DROP TABLE IF EXISTS public.assistant_store_assistants;

COMMIT;
