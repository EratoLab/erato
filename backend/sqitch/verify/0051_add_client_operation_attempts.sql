-- Verify erato:0051_add_client_operation_attempts on pg
BEGIN;
SELECT attempt_id, account_id, chat_id, message_id, tool_call_id, generation_id,
       request, state, claim_token, claim_binding, claim_expires_at, result,
       validated_result, expires_at, created_at, updated_at
FROM public.client_operation_attempts WHERE FALSE;
ROLLBACK;
