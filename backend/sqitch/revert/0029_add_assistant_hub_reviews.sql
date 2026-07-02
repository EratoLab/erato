-- Revert erato:0029_add_assistant_hub_reviews from pg

BEGIN;

DROP TABLE public.assistant_hub_reviews;

COMMIT;
