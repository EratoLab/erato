-- Verify erato:0042_add_decision_to_user_tool_approval_settings on pg

BEGIN;

SELECT decision
FROM public.user_tool_approval_settings
WHERE FALSE;

ROLLBACK;
