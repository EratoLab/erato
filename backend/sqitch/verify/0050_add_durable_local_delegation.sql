-- Verify erato:0050_add_durable_local_delegation on pg
BEGIN;
SELECT id,owner_user_id,chat_id,message_id,tool_call_id,attempt_id,task_id,plan,checkpoint,binding,origin,state,generation_id,approved_export,server_outcome,receipt,export_id,manifest_digest,expires_at,accepted_at
FROM public.local_delegation_jobs WHERE FALSE;
SELECT 1 / CASE WHEN relpersistence = 'p' THEN 1 ELSE 0 END FROM pg_class WHERE oid='public.local_delegation_jobs'::regclass;
ROLLBACK;
