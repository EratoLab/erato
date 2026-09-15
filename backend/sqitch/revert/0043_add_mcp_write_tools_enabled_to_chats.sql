-- Revert erato:0043_add_mcp_write_tools_enabled_to_chats from pg

BEGIN;

ALTER TABLE public.chats
    DROP COLUMN mcp_write_tools_enabled;

COMMIT;
