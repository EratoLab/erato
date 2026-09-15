-- Deploy erato:0046_widen_user_tool_approval_decisions to pg

BEGIN;

ALTER TABLE public.user_tool_approval_settings
    DROP CONSTRAINT user_tool_approval_settings_decision_check;

ALTER TABLE public.user_tool_approval_settings
    ADD CONSTRAINT user_tool_approval_settings_decision_check
    CHECK (decision IN ('always_allow', 'ask', 'denied'));

COMMIT;
