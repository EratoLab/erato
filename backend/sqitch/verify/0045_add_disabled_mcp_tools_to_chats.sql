-- Verify erato:0045_add_disabled_mcp_tools_to_chats on pg

BEGIN;

SELECT disabled_mcp_tools
FROM public.chats
WHERE FALSE;

ROLLBACK;
