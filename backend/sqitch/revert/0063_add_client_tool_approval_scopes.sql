-- Revert erato:0063_add_client_tool_approval_scopes from pg

BEGIN;

ALTER TABLE public.client_executor_calls DROP COLUMN scoped;
ALTER TABLE public.client_executor_presence DROP COLUMN scoped_client_tools;
DROP TABLE public.client_tool_approval_scopes;

COMMIT;
