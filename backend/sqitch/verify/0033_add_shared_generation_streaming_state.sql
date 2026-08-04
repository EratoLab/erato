-- Verify erato:0033_add_shared_generation_streaming_state on pg

BEGIN;

SELECT generation_id, chat_id, message_id, owner_pod, state,
       started_at, heartbeat_at, ended_at
FROM public.temp_chat_generations
WHERE FALSE;

SELECT event_id, generation_id, event, created_at
FROM public.temp_chat_generation_events
WHERE FALSE;

SELECT command_id, generation_id, command_type, tool_call_id, payload,
       created_at, consumed_at
FROM public.temp_chat_generation_commands
WHERE FALSE;

ROLLBACK;
