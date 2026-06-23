-- Verify erato:0027_assistant_store_featured_assistant_wide on pg

BEGIN;

SELECT featured
FROM public.assistant_store_assistants
WHERE false;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'assistant_store_assistant_versions'
          AND column_name = 'featured'
    ) THEN
        RAISE EXCEPTION 'assistant_store_assistant_versions.featured should not exist';
    END IF;
END $$;

ROLLBACK;
