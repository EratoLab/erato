-- Revert erato:0042_add_decision_to_user_tool_approval_settings from pg

BEGIN;

ALTER TABLE public.user_tool_approval_settings
    DROP COLUMN decision;

COMMIT;
