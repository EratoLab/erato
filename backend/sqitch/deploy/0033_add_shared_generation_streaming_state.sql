-- Deploy erato:0033_add_shared_generation_streaming_state to pg

BEGIN;

-- These tables contain ephemeral coordination state. UNLOGGED keeps generation
-- deltas and commands out of WAL; a database restart discards them and the
-- application reaper reconciles the corresponding chat lease.
CREATE UNLOGGED TABLE public.temp_chat_generations (
    generation_id uuid PRIMARY KEY,
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    message_id uuid DEFAULT NULL,
    owner_pod text NOT NULL,
    state text NOT NULL DEFAULT 'running',
    started_at timestamptz NOT NULL DEFAULT now(),
    heartbeat_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz DEFAULT NULL,
    CONSTRAINT temp_chat_generations_chat_key UNIQUE (chat_id)
);

CREATE INDEX temp_chat_generations_heartbeat_idx
    ON public.temp_chat_generations (heartbeat_at)
    WHERE state = 'running';

CREATE UNLOGGED TABLE public.temp_chat_generation_events (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    generation_id uuid NOT NULL REFERENCES public.temp_chat_generations(generation_id) ON DELETE CASCADE,
    event jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX temp_chat_generation_events_generation_idx
    ON public.temp_chat_generation_events (generation_id, event_id);

CREATE UNLOGGED TABLE public.temp_chat_generation_commands (
    command_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    generation_id uuid NOT NULL REFERENCES public.temp_chat_generations(generation_id) ON DELETE CASCADE,
    command_type text NOT NULL,
    tool_call_id text DEFAULT NULL,
    payload jsonb DEFAULT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz DEFAULT NULL
);

CREATE INDEX temp_chat_generation_commands_pending_idx
    ON public.temp_chat_generation_commands (generation_id, command_id)
    WHERE consumed_at IS NULL;

COMMIT;
