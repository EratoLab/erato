-- Deploy erato:0058_add_client_operation_transports to pg
BEGIN;
CREATE TABLE public.client_operation_transports (
    chat_id uuid PRIMARY KEY REFERENCES public.chats(id) ON DELETE CASCADE,
    generation_id uuid NOT NULL UNIQUE,
    binding jsonb NOT NULL,
    operation_id text NOT NULL,
    transport_id uuid,
    expires_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
