-- Verify erato:0051_add_durable_local_delegation on pg
BEGIN;
SELECT id,owner_user_id,chat_id,message_id,tool_call_id,attempt_id,task_id,plan,checkpoint,binding,origin,state,generation_id,approved_export,server_outcome,receipt,export_id,manifest_digest,expires_at,accepted_at,updated_at
FROM public.local_delegation_jobs WHERE FALSE;
SELECT 1 / CASE WHEN relpersistence = 'p' THEN 1 ELSE 0 END FROM pg_class WHERE oid='public.local_delegation_jobs'::regclass;
SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.local_delegation_jobs'::regclass AND tgname='on_update_set_updated_columns_local_delegation_jobs') THEN 1 ELSE 0 END;
ROLLBACK;
