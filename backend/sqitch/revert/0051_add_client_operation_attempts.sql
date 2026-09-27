-- Revert erato:0051_add_client_operation_attempts from pg
BEGIN;
DROP TABLE public.client_operation_attempts;
COMMIT;
