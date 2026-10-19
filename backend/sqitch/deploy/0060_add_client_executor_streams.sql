-- Deploy erato:0060_add_client_executor_streams to pg

BEGIN;

-- Ephemeral routing state for executor streams. UNLOGGED like the generation
-- command queue: a database restart drops presence and undelivered calls, and
-- running calls then settle through their presence-loss grace or timeout.
CREATE UNLOGGED TABLE public.client_executor_presence (
    account_id uuid NOT NULL,
    binding jsonb NOT NULL,
    stream_id uuid NOT NULL UNIQUE,
    client_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
    child_client_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, binding)
);

CREATE UNLOGGED TABLE public.client_executor_calls (
    call_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id uuid NOT NULL,
    binding jsonb NOT NULL,
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    message_id uuid NOT NULL,
    tool_call_id text NOT NULL,
    -- Set only for durable-operation nudges.
    attempt_id uuid DEFAULT NULL,
    event jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz DEFAULT NULL,
    delivered_to uuid DEFAULT NULL
);

CREATE INDEX client_executor_calls_pending_idx
    ON public.client_executor_calls (account_id, binding)
    WHERE delivered_at IS NULL;

CREATE UNIQUE INDEX client_executor_calls_call_key
    ON public.client_executor_calls (message_id, tool_call_id)
    WHERE attempt_id IS NULL;

COMMIT;
