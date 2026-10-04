-- Verify erato:0057_add_ms_teams_requests on pg
BEGIN;
SELECT id, conversation_id, source_activity_id, user_id, chat_id,
       user_message_id, assistant_message_id, control_activity_id, state,
       tools_started, pending_edit, last_edit_at, action_token, action_kind,
       action_expires_at, run_id, claimed_action_token, created_at, updated_at
FROM public.ms_teams_requests WHERE FALSE;
ROLLBACK;
