-- Revert erato:0034_add_user_tool_approval_settings from pg

BEGIN;
DROP TABLE public.user_tool_approval_settings;
COMMIT;
