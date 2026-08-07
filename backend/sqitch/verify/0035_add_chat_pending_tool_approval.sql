-- Verify erato:0035_add_chat_pending_tool_approval on pg

BEGIN;
SELECT pending_tool_approval_at
FROM public.chats
WHERE FALSE;
ROLLBACK;
