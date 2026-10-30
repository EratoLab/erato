-- Deploy erato:0063_add_client_tool_approval_scopes to pg

BEGIN;

-- One row per approval decision that covers a document or response; at most
-- one live row per key.
CREATE TABLE public.client_tool_approval_scopes (
    id uuid PRIMARY KEY,
    -- The parent chat the decision was made in; a task uses it through its grant.
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    binding_digest text NOT NULL CHECK (char_length(binding_digest) = 64),
    host_context text NOT NULL CHECK (char_length(host_context) BETWEEN 1 AND 64),
    scope_id text NOT NULL CHECK (char_length(scope_id) BETWEEN 1 AND 256),
    tool_name text NOT NULL CHECK (char_length(tool_name) BETWEEN 1 AND 256),
    decided_in_message_id uuid NOT NULL,
    decided_stop integer NOT NULL,
    -- The host's position at the decision; NULL for scopes not checked on the device.
    position jsonb DEFAULT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz DEFAULT NULL,
    end_reason text DEFAULT NULL
);

CREATE UNIQUE INDEX client_tool_approval_scopes_live_key
    ON public.client_tool_approval_scopes (chat_id, binding_digest, host_context, scope_id, tool_name)
    WHERE ended_at IS NULL;

CREATE UNIQUE INDEX client_tool_approval_scopes_decision
    ON public.client_tool_approval_scopes
    (chat_id, binding_digest, host_context, scope_id, tool_name, decided_in_message_id, decided_stop);

CREATE INDEX client_tool_approval_scopes_latest
    ON public.client_tool_approval_scopes
    (chat_id, binding_digest, host_context, scope_id, tool_name, created_at DESC);

-- Tools the stream checks a covered call's approval scope for before reading.
ALTER TABLE public.client_executor_presence
    ADD COLUMN scoped_client_tools jsonb NOT NULL DEFAULT '[]'::jsonb;

-- A covered call goes only to a stream that checks its scope.
ALTER TABLE public.client_executor_calls
    ADD COLUMN scoped boolean NOT NULL DEFAULT false;

COMMIT;
