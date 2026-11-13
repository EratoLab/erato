-- Verify erato:0070_add_excel_and_powerpoint_created_via on pg

BEGIN;

SELECT 1/COUNT(*)
FROM pg_constraint
WHERE conname = 'chats_created_via_check'
  AND pg_get_constraintdef(oid) LIKE '%excel%'
  AND pg_get_constraintdef(oid) LIKE '%powerpoint%';

ROLLBACK;
