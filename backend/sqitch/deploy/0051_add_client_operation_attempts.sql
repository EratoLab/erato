-- Deploy erato:0051_add_client_operation_attempts to pg
BEGIN;
CREATE TABLE public.client_operation_attempts (
    attempt_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    tool_call_id text NOT NULL,
    generation_id uuid NOT NULL,
    request jsonb NOT NULL,
    state text NOT NULL CHECK (state IN ('pending', 'claimed', 'ready', 'continuing', 'completed')),
    claim_token uuid,
    claim_binding jsonb,
    claim_expires_at timestamptz,
    result jsonb,
    validated_result jsonb,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(message_id, tool_call_id),
    CHECK ((result IS NULL) = (validated_result IS NULL))
);
CREATE INDEX client_operation_attempts_inbox ON public.client_operation_attempts(account_id, attempt_id)
    WHERE state <> 'completed';
CREATE INDEX client_operation_attempts_chat ON public.client_operation_attempts(chat_id)
    WHERE state <> 'completed';
CREATE TRIGGER on_update_set_updated_columns_client_operation_attempts
    BEFORE UPDATE ON public.client_operation_attempts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();
COMMIT;
