-- Deploy erato:0056_add_ms_teams_pending_sign_ins to pg
BEGIN;

-- The original activity is kept only until sign-in completes or expires.
-- A consumed row remains until expiry to deduplicate incoming message retries.
CREATE TABLE public.ms_teams_pending_sign_ins (
    id uuid PRIMARY KEY DEFAULT public.uuidv7(),
    bot_app_id text NOT NULL,
    tenant_id text NOT NULL,
    connection_name text NOT NULL,
    conversation_id text NOT NULL,
    ms_teams_user_id text NOT NULL,
    entra_object_id text NOT NULL,
    source_conversation_id text NOT NULL,
    source_activity_id text NOT NULL,
    exchange_id text,
    activity jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    UNIQUE (bot_app_id, tenant_id, connection_name, ms_teams_user_id,
            source_conversation_id, source_activity_id)
);
CREATE INDEX ms_teams_pending_sign_ins_scope ON public.ms_teams_pending_sign_ins
    (bot_app_id, tenant_id, connection_name, conversation_id, ms_teams_user_id, entra_object_id);
CREATE INDEX ms_teams_pending_sign_ins_expiry ON public.ms_teams_pending_sign_ins (expires_at);

COMMIT;
