-- Deploy erato:0044_add_disabled_mcp_server_ids_to_chats to pg

BEGIN;

ALTER TABLE public.chats
    ADD COLUMN disabled_mcp_server_ids text[] NOT NULL DEFAULT '{}';

COMMIT;
