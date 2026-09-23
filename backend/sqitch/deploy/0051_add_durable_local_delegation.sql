-- Deploy erato:0051_add_durable_local_delegation to pg
BEGIN;
-- This table is deliberately LOGGED. Neither in-process channels nor the
-- UNLOGGED generation-command queue own acceptance or continuation recovery.
CREATE TABLE public.local_delegation_jobs (
    id uuid PRIMARY KEY,
    owner_user_id text NOT NULL,
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    tool_call_id text NOT NULL,
    attempt_id uuid NOT NULL,
    task_id text NOT NULL,
    plan jsonb NOT NULL,
    checkpoint jsonb NOT NULL,
    binding jsonb,
    origin text,
    state text NOT NULL DEFAULT 'waiting_for_local_result'
        CHECK (state IN ('waiting_for_local_result','awaiting_authenticated_resume','continuing','completed','cancelled','expired')),
    generation_id uuid,
    approved_export jsonb,
    server_outcome jsonb CHECK (server_outcome IS NULL OR server_outcome IN ('{"status":"expired"}'::jsonb,'{"status":"cancelled"}'::jsonb)),
    receipt text,
    export_id text UNIQUE,
    manifest_digest text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    UNIQUE(message_id,tool_call_id),
    CHECK ((binding IS NULL) = (origin IS NULL)),
    CHECK ((approved_export IS NULL) = (receipt IS NULL)),
    CHECK (state NOT IN ('awaiting_authenticated_resume','continuing','completed') OR receipt IS NOT NULL OR server_outcome IS NOT NULL)
);
CREATE TRIGGER on_update_set_updated_columns_local_delegation_jobs
    BEFORE UPDATE ON public.local_delegation_jobs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();
CREATE INDEX local_delegation_owner_pending_idx ON public.local_delegation_jobs(owner_user_id,created_at)
    WHERE state IN ('waiting_for_local_result','awaiting_authenticated_resume','continuing');
CREATE INDEX local_delegation_chat_idx ON public.local_delegation_jobs(chat_id);
COMMENT ON TABLE public.local_delegation_jobs IS 'Durable local task/checkpoint, exact approved export and continuation intent; never store frontend/native handles, native statuses, or access/refresh tokens';
COMMIT;
