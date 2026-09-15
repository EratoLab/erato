-- Verify erato:0044_add_disabled_mcp_server_ids_to_chats on pg

BEGIN;

SELECT disabled_mcp_server_ids
FROM public.chats
WHERE FALSE;

ROLLBACK;
