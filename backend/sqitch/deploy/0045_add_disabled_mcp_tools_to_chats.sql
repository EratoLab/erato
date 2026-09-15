-- Deploy erato:0045_add_disabled_mcp_tools_to_chats to pg

BEGIN;

ALTER TABLE public.chats
    ADD COLUMN disabled_mcp_tools text[] NOT NULL DEFAULT '{}';

COMMIT;
