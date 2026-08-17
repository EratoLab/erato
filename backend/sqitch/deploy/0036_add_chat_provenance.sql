-- Deploy erato:0036_add_chat_provenance to pg

BEGIN;

ALTER TABLE public.chats
    ADD COLUMN origin_chat_id uuid
    GENERATED ALWAYS AS (((assistant_configuration #>> '{provenance,origin_chat_id}'))::uuid) STORED;

CREATE INDEX idx_chats_origin_chat_id
    ON public.chats (origin_chat_id)
    WHERE origin_chat_id IS NOT NULL;

CREATE INDEX idx_chats_delegated_runs
    ON public.chats (owner_user_id, updated_at DESC)
    WHERE (assistant_configuration #>> '{provenance,kind}') = 'delegation';

COMMIT;
