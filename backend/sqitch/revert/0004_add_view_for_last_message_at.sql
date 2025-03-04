-- Revert erato:0004_add_view_for_last_message_at from pg

BEGIN;

-- Drop the view for latest messages
DROP VIEW IF EXISTS chats_latest_message;

COMMIT;
