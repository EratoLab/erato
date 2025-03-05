-- Revert erato:0005_adjust_message_lineage from pg

BEGIN;

-- Drop the constraint trigger and function for checking active thread siblings
DROP TRIGGER IF EXISTS ensure_single_active_message_in_thread ON public.messages;
DROP FUNCTION IF EXISTS public.check_active_thread_siblings_constraint();

-- Drop the indexes created for the new columns
DROP INDEX IF EXISTS idx_messages_previous_message_id;
DROP INDEX IF EXISTS idx_messages_sibling_message_id;
DROP INDEX IF EXISTS idx_messages_active_thread;

-- Revert the messages table structure changes
ALTER TABLE public.messages
    -- Add back the order_index column
    ADD COLUMN order_index integer,
    -- Drop the new columns
    DROP COLUMN IF EXISTS previous_message_id,
    DROP COLUMN IF EXISTS sibling_message_id,
    DROP COLUMN IF EXISTS is_message_in_active_thread,
    DROP COLUMN IF EXISTS generation_input_messages;

-- Set order_index to a default value since we can't easily restore the original values
UPDATE public.messages SET order_index = 0;

-- Make order_index NOT NULL again
ALTER TABLE public.messages
    ALTER COLUMN order_index SET NOT NULL;

COMMIT;
