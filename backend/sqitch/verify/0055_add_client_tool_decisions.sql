-- Verify erato:0055_add_client_tool_decisions on pg
BEGIN;
SELECT client_tool_decisions FROM public.user_preferences WHERE FALSE;
ROLLBACK;
