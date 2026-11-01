-- Verify erato:0063_add_client_tool_approval_scopes on pg

BEGIN;

SELECT id, chat_id, binding_digest, host_context, scope_id, tool_name, decided_in_message_id,
       decided_stop, position, created_at, ended_at, end_reason
FROM public.client_tool_approval_scopes WHERE false;
SELECT scoped_client_tools FROM public.client_executor_presence WHERE false;
SELECT scoped FROM public.client_executor_calls WHERE false;

ROLLBACK;
