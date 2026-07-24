-- Revert erato:0030_add_generation_state_to_chats from pg

BEGIN;

DROP INDEX public.chats_generation_state_idx;

ALTER TABLE public.chats DROP COLUMN generation_ended_at;
ALTER TABLE public.chats DROP COLUMN generation_heartbeat_at;
ALTER TABLE public.chats DROP COLUMN generation_started_at;
ALTER TABLE public.chats DROP COLUMN generation_state;
ALTER TABLE public.chats DROP COLUMN active_generation_id;

COMMIT;
