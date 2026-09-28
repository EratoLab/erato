-- Verify erato:0053_add_teams_bot on pg
BEGIN;
SELECT entra_object_id FROM public.users WHERE FALSE;
SELECT id, conversation_id, conversation_type, user_id, current_chat_id, service_url,
       teams_user_id, created_at, updated_at
FROM public.teams_conversations WHERE FALSE;
SELECT exchange_id, created_at FROM public.teams_token_exchanges WHERE FALSE;
ROLLBACK;
