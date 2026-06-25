-- Verify erato:0028_rename_assistant_store_to_assistant_hub on pg

BEGIN;

SELECT id, source_assistant_id, owner_user_id, created_at, updated_at, featured
FROM public.assistant_hub_assistants
WHERE false;

SELECT
    id,
    assistant_hub_assistant_id,
    assistant_id,
    status,
    is_published,
    is_current_published_version,
    version_number,
    version_comment,
    creator_review_comment,
    reviewer_review_comment,
    long_description,
    category_ids,
    keywords,
    diff_summary,
    submitted_at,
    reviewed_at,
    withdrawn_at,
    published_at,
    created_at,
    updated_at
FROM public.assistant_hub_assistant_versions
WHERE false;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('assistant_store_assistants', 'assistant_store_assistant_versions')
    ) THEN
        RAISE EXCEPTION 'assistant_store tables should not exist after assistant hub rename';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'assistant_hub_assistant_versions'
          AND column_name = 'assistant_store_assistant_id'
    ) THEN
        RAISE EXCEPTION 'assistant_hub_assistant_versions.assistant_store_assistant_id should not exist';
    END IF;
END $$;

ROLLBACK;
