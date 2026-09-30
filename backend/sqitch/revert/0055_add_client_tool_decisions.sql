-- Revert erato:0055_add_client_tool_decisions from pg
BEGIN;
ALTER TABLE public.user_preferences DROP COLUMN client_tool_decisions;
COMMIT;
