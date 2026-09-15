-- Revert erato:0044_add_disabled_mcp_server_ids_to_chats from pg

BEGIN;

ALTER TABLE public.chats
    DROP COLUMN disabled_mcp_server_ids;

COMMIT;
