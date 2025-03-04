-- Deploy erato:0004_add_view_for_last_message_at to pg

BEGIN;

-- Create a view that shows the latest message for each chat
CREATE VIEW chats_latest_message AS
SELECT 
    chat_id,
    id AS latest_message_id,
    created_at AS latest_message_at
FROM (
    SELECT 
        m.chat_id,
        m.id,
        m.created_at,
        ROW_NUMBER() OVER (PARTITION BY m.chat_id ORDER BY m.created_at DESC) AS rn
    FROM 
        messages m
) ranked_messages
WHERE 
    rn = 1;

COMMIT;
