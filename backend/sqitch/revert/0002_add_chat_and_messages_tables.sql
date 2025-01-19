-- Revert llmchat:0002_add_chat_and_messages_tables from pg

BEGIN;

DROP TABLE messages;
DROP TABLE chats;
DROP FUNCTION set_updated_at_column();
DROP FUNCTION uuidv7(timestamptz);

COMMIT;
