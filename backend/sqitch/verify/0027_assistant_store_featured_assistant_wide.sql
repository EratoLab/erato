-- Verify erato:0027_assistant_store_featured_assistant_wide on pg

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.assistant_hub_assistants') IS NOT NULL THEN
        EXECUTE 'SELECT featured FROM public.assistant_hub_assistants WHERE false';

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'assistant_hub_assistant_versions'
              AND column_name = 'featured'
        ) THEN
            RAISE EXCEPTION 'assistant_hub_assistant_versions.featured should not exist';
        END IF;
    ELSE
        EXECUTE 'SELECT featured FROM public.assistant_store_assistants WHERE false';

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'assistant_store_assistant_versions'
              AND column_name = 'featured'
        ) THEN
            RAISE EXCEPTION 'assistant_store_assistant_versions.featured should not exist';
        END IF;
    END IF;
END $$;

ROLLBACK;
