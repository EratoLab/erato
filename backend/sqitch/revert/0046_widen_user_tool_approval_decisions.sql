-- Revert erato:0046_widen_user_tool_approval_decisions from pg

BEGIN;

DELETE FROM public.user_tool_approval_settings
WHERE decision = 'ask';

ALTER TABLE public.user_tool_approval_settings
    DROP CONSTRAINT user_tool_approval_settings_decision_check;

ALTER TABLE public.user_tool_approval_settings
    ADD CONSTRAINT user_tool_approval_settings_decision_check
    CHECK (decision IN ('always_allow', 'denied'));

COMMIT;
