-- Verify erato:0029_add_assistant_hub_reviews on pg

BEGIN;

SELECT
    id,
    assistant_hub_assistant_id,
    assistant_hub_assistant_version_id,
    reviewer_user_id,
    score,
    comment,
    created_at,
    updated_at
FROM public.assistant_hub_reviews
WHERE false;

ROLLBACK;
