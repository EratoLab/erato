-- Verify erato:0043_add_mcp_write_tools_enabled_to_chats on pg

BEGIN;

SELECT mcp_write_tools_enabled
FROM public.chats
WHERE FALSE;

ROLLBACK;
