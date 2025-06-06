-- Revert erato:0008_alter_messages_raw_message_structure_to_array from pg

BEGIN;

UPDATE messages
SET raw_message = jsonb_set(
    raw_message,
    '{content}',
    to_jsonb(raw_message->'content'->0->>'text') -- Convert the text to a proper JSONB string
)
WHERE
    jsonb_typeof(raw_message->'content') = 'array' -- Ensure 'content' is an array
    AND jsonb_array_length(raw_message->'content') > 0 -- Ensure the array is not empty
    AND raw_message->'content'->0->>'content_type' = 'text' -- Ensure the first element is a text part
    AND jsonb_typeof(raw_message->'content'->0->'text') = 'string'; -- Ensure the text field itself is a string

COMMIT;