-- Verify erato:0056_add_ms_teams_pending_sign_ins on pg
BEGIN;
SELECT id, bot_app_id, tenant_id, connection_name, conversation_id,
       ms_teams_user_id, entra_object_id, source_conversation_id,
       source_activity_id, exchange_id, activity, created_at, expires_at
FROM public.ms_teams_pending_sign_ins WHERE FALSE;
ROLLBACK;
