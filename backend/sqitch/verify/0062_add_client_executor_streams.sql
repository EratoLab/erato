-- Verify erato:0062_add_client_executor_streams on pg

BEGIN;

SELECT account_id, binding, stream_id, client_tools, child_client_tools, expires_at
FROM public.client_executor_presence WHERE false;
SELECT call_id, account_id, binding, chat_id, message_id, tool_call_id, generation_id,
       attempt_id, event, created_at, delivered_at, delivered_to
FROM public.client_executor_calls WHERE false;

ROLLBACK;
