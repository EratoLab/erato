-- Deploy erato:0027_assistant_store_featured_assistant_wide to pg

BEGIN;

ALTER TABLE public.assistant_store_assistants
    ADD COLUMN featured boolean DEFAULT false NOT NULL;

UPDATE public.assistant_store_assistants store_assistant
SET featured = true
WHERE EXISTS (
    SELECT 1
    FROM public.assistant_store_assistant_versions version
    WHERE version.assistant_store_assistant_id = store_assistant.id
      AND version.featured
);

CREATE INDEX idx_assistant_store_assistants_featured
    ON public.assistant_store_assistants USING btree (featured)
    WHERE featured;

DROP INDEX IF EXISTS public.idx_assistant_store_versions_featured;
ALTER TABLE public.assistant_store_assistant_versions DROP COLUMN featured;

COMMIT;
