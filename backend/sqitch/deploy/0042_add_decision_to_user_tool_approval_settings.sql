-- Deploy erato:0042_add_decision_to_user_tool_approval_settings to pg

BEGIN;

ALTER TABLE public.user_tool_approval_settings
    ADD COLUMN decision text NOT NULL DEFAULT 'always_allow'
    CHECK (decision IN ('always_allow', 'denied'));

COMMIT;
