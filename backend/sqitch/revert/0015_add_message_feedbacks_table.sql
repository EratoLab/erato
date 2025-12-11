-- Revert erato:0015_add_message_feedbacks_table from pg

BEGIN;

-- Drop the message_feedbacks table (cascade will remove dependent objects)
DROP TABLE IF EXISTS public.message_feedbacks;

COMMIT;
