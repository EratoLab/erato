-- Revert erato:0058_add_client_operation_transports from pg
BEGIN;
DROP TABLE public.client_operation_transports;
COMMIT;
