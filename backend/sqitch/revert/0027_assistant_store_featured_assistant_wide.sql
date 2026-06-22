-- Revert erato:0027_assistant_store_featured_assistant_wide from pg

BEGIN;

ALTER TABLE public.assistant_store_assistant_versions
    ADD COLUMN featured boolean DEFAULT false NOT NULL;

UPDATE public.assistant_store_assistant_versions version
SET featured = true
FROM public.assistant_store_assistants store_assistant
WHERE version.assistant_store_assistant_id = store_assistant.id
  AND store_assistant.featured;

CREATE INDEX idx_assistant_store_versions_featured
    ON public.assistant_store_assistant_versions USING btree (featured)
    WHERE featured;

DROP INDEX IF EXISTS public.idx_assistant_store_assistants_featured;
ALTER TABLE public.assistant_store_assistants DROP COLUMN IF EXISTS featured;

COMMIT;
