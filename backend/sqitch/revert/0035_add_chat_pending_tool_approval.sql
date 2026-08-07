-- Revert erato:0035_add_chat_pending_tool_approval from pg

BEGIN;

ALTER TABLE public.chats
    DROP COLUMN pending_tool_approval_at;

COMMIT;
