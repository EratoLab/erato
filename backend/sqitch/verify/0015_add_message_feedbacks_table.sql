-- Verify erato:0015_add_message_feedbacks_table on pg

BEGIN;

-- Verify the table exists
SELECT id, message_id, sentiment, comment, created_at, updated_at
FROM public.message_feedbacks
WHERE FALSE;

ROLLBACK;
