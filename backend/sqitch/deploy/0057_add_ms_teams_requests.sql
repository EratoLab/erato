-- Deploy erato:0057_add_ms_teams_requests to pg
BEGIN;

-- Durable routing and one-use controls for Teams turns. The user and chat
-- bindings are server-owned; card payloads contain only opaque record IDs.
CREATE TABLE public.ms_teams_requests (
    id uuid PRIMARY KEY DEFAULT public.uuidv7(),
    conversation_id text NOT NULL,
    source_activity_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    user_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
    assistant_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
    control_activity_id text,
    state text NOT NULL DEFAULT 'preparing'
        CHECK (state IN ('preparing', 'running', 'stopping', 'stopped', 'failed', 'completed')),
    tools_started boolean NOT NULL DEFAULT false,
    pending_edit text,
    last_edit_at timestamptz,
    action_token uuid,
    action_kind text CHECK (action_kind IN ('retry', 'edit')),
    action_expires_at timestamptz,
    run_id uuid NOT NULL DEFAULT public.uuidv7(),
    claimed_action_token uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, source_activity_id, user_id)
);
CREATE INDEX ms_teams_requests_assistant_message
    ON public.ms_teams_requests (assistant_message_id);

COMMIT;
