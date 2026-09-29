-- Verify erato:0054_add_chat_created_via on pg

BEGIN;

SELECT created_via
FROM public.chats
WHERE FALSE;

ROLLBACK;
