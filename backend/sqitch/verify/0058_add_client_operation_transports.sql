-- Verify erato:0058_add_client_operation_transports on pg
BEGIN;
SELECT chat_id, generation_id, binding, operation_id, transport_id, expires_at
FROM public.client_operation_transports WHERE false;
ROLLBACK;
