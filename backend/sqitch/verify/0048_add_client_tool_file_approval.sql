-- Verify erato:0048_add_client_tool_file_approval on pg
BEGIN;
SELECT client_tool_file_approval FROM public.user_preferences WHERE FALSE;
ROLLBACK;
