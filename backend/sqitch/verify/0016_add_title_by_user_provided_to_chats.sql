-- Verify erato:0016_add_title_by_user_provided_to_chats on pg

BEGIN;

SELECT id, title_by_user_provided
FROM public.chats
WHERE FALSE;

ROLLBACK;
