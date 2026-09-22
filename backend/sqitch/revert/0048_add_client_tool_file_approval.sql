-- Revert erato:0048_add_client_tool_file_approval from pg
BEGIN;
ALTER TABLE public.user_preferences DROP COLUMN client_tool_file_approval;
COMMIT;
