-- Deploy erato:0030_add_generation_state_to_chats to pg

BEGIN;

-- Persisted generation status for the sidebar: the lease identity of the
-- in-flight generation plus its lifecycle timestamps and terminal state.
ALTER TABLE public.chats ADD COLUMN active_generation_id uuid DEFAULT NULL;
ALTER TABLE public.chats ADD COLUMN generation_state text DEFAULT NULL;
ALTER TABLE public.chats ADD COLUMN generation_started_at timestamptz DEFAULT NULL;
ALTER TABLE public.chats ADD COLUMN generation_heartbeat_at timestamptz DEFAULT NULL;
ALTER TABLE public.chats ADD COLUMN generation_ended_at timestamptz DEFAULT NULL;

CREATE INDEX chats_generation_state_idx ON public.chats (owner_user_id)
    WHERE generation_state IS NOT NULL;

COMMIT;
