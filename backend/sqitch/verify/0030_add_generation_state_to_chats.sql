-- Verify erato:0030_add_generation_state_to_chats on pg

BEGIN;

SELECT id,
       active_generation_id,
       generation_state,
       generation_started_at,
       generation_heartbeat_at,
       generation_ended_at
FROM public.chats
WHERE FALSE;

ROLLBACK;
