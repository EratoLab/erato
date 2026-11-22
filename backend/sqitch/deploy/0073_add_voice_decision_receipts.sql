-- Deploy erato:0073_add_voice_decision_receipts to pg
-- requires: 0072_add_wait_lines_preference

BEGIN;

-- A decision by voice the voice command endpoint accepted, waiting for the
-- decision to arrive with its id. In the database so that any replica takes
-- it, also after a restart. Taken once (deleted), valid until `expires_at`;
-- a card has at most one, a newer one replaces it.
CREATE TABLE public.voice_decision_receipts (
    id uuid PRIMARY KEY DEFAULT public.uuidv7(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    approval_id text NOT NULL,
    card_digest text NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('approved', 'refused')),
    -- How the decision was given, stored with the decision once it arrives.
    record jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX voice_decision_receipts_card
    ON public.voice_decision_receipts (user_id, message_id, approval_id);
CREATE INDEX voice_decision_receipts_expires
    ON public.voice_decision_receipts (expires_at);

COMMIT;
