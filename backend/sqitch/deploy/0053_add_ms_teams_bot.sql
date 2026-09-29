-- Deploy erato:0053_add_ms_teams_bot to pg
BEGIN;

-- Entra ID object ID (`oid`), recorded on every web/tab login. The Teams bot
-- only knows a user by this ID, so it is the lookup key for bot requests.
ALTER TABLE public.users ADD COLUMN entra_object_id text;
CREATE UNIQUE INDEX users_entra_object_id_unique ON public.users(entra_object_id)
    WHERE entra_object_id IS NOT NULL;

-- One row per Teams conversation and user. A personal chat has one row; group
-- chats and channel threads have one row per user who talks to the bot there.
CREATE TABLE public.ms_teams_conversations (
    id uuid PRIMARY KEY DEFAULT public.uuidv7(),
    conversation_id text NOT NULL,
    conversation_type text NOT NULL CHECK (conversation_type IN ('personal', 'groupChat', 'channel')),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    current_chat_id uuid REFERENCES public.chats(id) ON DELETE SET NULL,
    service_url text NOT NULL,
    ms_teams_user_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, user_id)
);
CREATE INDEX ms_teams_conversations_current_chat ON public.ms_teams_conversations(current_chat_id)
    WHERE current_chat_id IS NOT NULL;
CREATE TRIGGER on_update_set_updated_columns_teams_conversations
    BEFORE UPDATE ON public.ms_teams_conversations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- Teams sends the same SSO token-exchange invoke to every open client of a
-- user; the first replica to insert the exchange ID processes it.
CREATE TABLE public.ms_teams_token_exchanges (
    exchange_id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
