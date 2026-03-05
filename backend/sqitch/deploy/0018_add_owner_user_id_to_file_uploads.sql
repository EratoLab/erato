-- Deploy erato:0018_add_owner_user_id_to_file_uploads to pg

BEGIN;

ALTER TABLE public.file_uploads
    ADD COLUMN owner_user_id text;

-- Backfill from chats for files linked to chats.
UPDATE public.file_uploads fu
SET owner_user_id = sub.owner_user_id
FROM (
    SELECT cfu.file_upload_id, MIN(c.owner_user_id) AS owner_user_id
    FROM public.chat_file_uploads cfu
    JOIN public.chats c ON c.id = cfu.chat_id
    GROUP BY cfu.file_upload_id
) sub
WHERE fu.id = sub.file_upload_id
  AND fu.owner_user_id IS NULL;

-- Backfill from assistants for files linked to assistants.
UPDATE public.file_uploads fu
SET owner_user_id = sub.owner_user_id
FROM (
    SELECT afu.file_upload_id, MIN(a.owner_user_id::text) AS owner_user_id
    FROM public.assistant_file_uploads afu
    JOIN public.assistants a ON a.id = afu.assistant_id
    GROUP BY afu.file_upload_id
) sub
WHERE fu.id = sub.file_upload_id
  AND fu.owner_user_id IS NULL;

-- Keep migration robust in case historical orphan rows exist.
UPDATE public.file_uploads
SET owner_user_id = '__unknown_owner__'
WHERE owner_user_id IS NULL;

ALTER TABLE public.file_uploads
    ALTER COLUMN owner_user_id SET NOT NULL;

CREATE INDEX idx_file_uploads_owner_user_id ON public.file_uploads USING btree (owner_user_id);

COMMIT;
