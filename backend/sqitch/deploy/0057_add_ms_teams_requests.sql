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
    -- Teams supplies its own Stop button while a native stream is open.
    native_stop_available boolean NOT NULL DEFAULT false,
    pending_edit text,
    last_edit_at timestamptz,
    action_token uuid,
    action_kind text CHECK (action_kind IN ('retry', 'edit')),
    action_expires_at timestamptz,
    run_id uuid NOT NULL DEFAULT public.uuidv7(),
    claimed_action_token uuid,
    -- Control cards are delivered without holding a transaction across the
    -- Connector call: writers bump the version, and one lease holder renders
    -- until the version it delivered is the latest.
    controls_version bigint NOT NULL DEFAULT 0,
    controls_lease_owner uuid,
    controls_lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, source_activity_id, user_id)
);
CREATE INDEX ms_teams_requests_user_conversation
    ON public.ms_teams_requests (user_id, conversation_id, created_at DESC);
CREATE INDEX ms_teams_requests_chat ON public.ms_teams_requests (chat_id);
CREATE INDEX ms_teams_requests_user_message ON public.ms_teams_requests (user_message_id)
    WHERE user_message_id IS NOT NULL;
CREATE INDEX ms_teams_requests_assistant_message ON public.ms_teams_requests (assistant_message_id)
    WHERE assistant_message_id IS NOT NULL;
CREATE TRIGGER on_update_set_updated_columns_ms_teams_requests
    BEFORE UPDATE ON public.ms_teams_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
