-- Verify erato:0034_add_user_tool_approval_settings on pg

BEGIN;
SELECT id, user_id, mcp_server_id, tool_name, active, deactivated_at
FROM public.user_tool_approval_settings
WHERE FALSE;
ROLLBACK;
