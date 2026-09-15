-- Verify erato:0046_widen_user_tool_approval_decisions on pg

BEGIN;

SELECT 1/COUNT(*)
FROM pg_constraint
WHERE conname = 'user_tool_approval_settings_decision_check'
  AND pg_get_constraintdef(oid) LIKE '%ask%';

ROLLBACK;
