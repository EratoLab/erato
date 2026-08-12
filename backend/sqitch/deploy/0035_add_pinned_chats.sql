-- Deploy erato:0035_add_pinned_chats to pg

BEGIN;

ALTER TABLE public.chats
    ADD COLUMN is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX idx_chats_owner_user_id_is_pinned
    ON public.chats (owner_user_id, is_pinned);

COMMIT;
