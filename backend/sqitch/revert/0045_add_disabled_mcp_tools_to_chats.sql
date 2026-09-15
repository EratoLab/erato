-- Revert erato:0045_add_disabled_mcp_tools_to_chats from pg

BEGIN;

ALTER TABLE public.chats
    DROP COLUMN disabled_mcp_tools;

COMMIT;
