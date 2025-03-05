-- Deploy erato:0005_adjust_message_lineage to pg

BEGIN;

-- Truncate existing data (since there's no deployed version yet)
TRUNCATE public.messages CASCADE;
TRUNCATE public.chats CASCADE;

-- Modify the messages table structure
ALTER TABLE public.messages
    -- Add new columns for message lineage
    ADD COLUMN previous_message_id uuid REFERENCES public.messages(id),
    ADD COLUMN sibling_message_id uuid REFERENCES public.messages(id),
    ADD COLUMN is_message_in_active_thread boolean NOT NULL DEFAULT true,
    ADD COLUMN generation_input_messages jsonb,
    -- Drop the order_index column as it's no longer needed
    DROP COLUMN order_index;

-- Create a function to check if the active thread constraint is satisfied
CREATE OR REPLACE FUNCTION public.check_active_thread_siblings_constraint()
RETURNS trigger AS $$
DECLARE
    violation_found boolean;
BEGIN
    -- Check if there are any sibling groups with multiple active messages
    SELECT EXISTS (
        WITH sibling_groups AS (
            -- Find all sibling relationships
            SELECT 
                CASE 
                    WHEN m1.sibling_message_id IS NOT NULL THEN m1.sibling_message_id
                    ELSE m1.id
                END AS group_id,
                m1.id,
                m1.is_message_in_active_thread
            FROM public.messages m1
            
            UNION
            
            SELECT 
                CASE 
                    WHEN m2.sibling_message_id IS NOT NULL THEN m2.sibling_message_id
                    ELSE m2.id
                END AS group_id,
                m2.id,
                m2.is_message_in_active_thread
            FROM public.messages m2
            WHERE m2.sibling_message_id IS NOT NULL
        ),
        -- Count active messages per group
        active_counts AS (
            SELECT 
                group_id,
                SUM(CASE WHEN is_message_in_active_thread THEN 1 ELSE 0 END) AS active_count
            FROM sibling_groups
            GROUP BY group_id
        )
        -- Find groups with more than one active message
        SELECT 1
        FROM active_counts
        WHERE active_count > 1
        LIMIT 1
    ) INTO violation_found;
    
    IF violation_found THEN
        RAISE EXCEPTION 'Constraint violation: Multiple messages in the same sibling group are marked as active';
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create a constraint trigger that runs at the end of the transaction
CREATE CONSTRAINT TRIGGER ensure_single_active_message_in_thread
AFTER INSERT OR UPDATE
ON public.messages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_active_thread_siblings_constraint();

-- Create indexes for the new columns to improve query performance
CREATE INDEX idx_messages_previous_message_id ON public.messages(previous_message_id);
CREATE INDEX idx_messages_sibling_message_id ON public.messages(sibling_message_id);
CREATE INDEX idx_messages_active_thread ON public.messages(is_message_in_active_thread) WHERE is_message_in_active_thread = true;

COMMIT;
