-- Verify erato:0026_add_assistant_store_tables on pg

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.assistant_hub_assistants') IS NOT NULL THEN
        EXECUTE 'SELECT id, source_assistant_id, owner_user_id, created_at, updated_at FROM public.assistant_hub_assistants WHERE false';
        EXECUTE '
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
            WHERE false
        ';
    ELSE
        EXECUTE 'SELECT id, source_assistant_id, owner_user_id, created_at, updated_at FROM public.assistant_store_assistants WHERE false';
        EXECUTE '
            SELECT
                id,
                assistant_store_assistant_id,
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
            FROM public.assistant_store_assistant_versions
            WHERE false
        ';
    END IF;
END $$;

ROLLBACK;
