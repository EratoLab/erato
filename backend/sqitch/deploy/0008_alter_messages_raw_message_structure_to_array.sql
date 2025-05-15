-- Deploy erato:0008_alter_messages_raw_message_structure_to_array to pg

BEGIN;

UPDATE messages
SET raw_message = jsonb_set(
    raw_message, -- The JSONB document to update
    '{content}', -- The path to the key to update/set
    jsonb_build_array( -- Create a new JSON array
        jsonb_build_object( -- Create a JSON object for the ContentPart
            'content_type', 'text',
            'text', raw_message->>'content' -- Get the 'content' value as text and wrap it in the new structure
        )
    )
)
WHERE
    jsonb_typeof(raw_message->'content') = 'string' -- Ensure we only process messages where 'content' is currently a string
    AND raw_message->'content' IS NOT NULL; -- And 'content' is not SQL NULL

COMMIT;
