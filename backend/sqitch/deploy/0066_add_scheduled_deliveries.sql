-- Deploy erato:0066_add_scheduled_deliveries to pg
-- requires: 0065_drop_local_evidence_exports

BEGIN;

-- One row per message Erato owes a user at a due time: reminders, nudges and
-- other notifications share this table and the executor that drains it.
-- Producers insert rows; the executor claims them with a compare-and-set,
-- delivers through a channel and records the outcome, so a row is delivered
-- at most once however many replicas run the executor.
CREATE TABLE public.scheduled_deliveries (
    id uuid PRIMARY KEY DEFAULT public.uuidv7(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    due_at timestamptz NOT NULL,
    created_by text NOT NULL CHECK (created_by IN ('system', 'user')),
    origin jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'claimed', 'delivered', 'cancelled', 'snoozed', 'failed')),
    claim_token text,
    claimed_at timestamptz,
    delivered_at timestamptz,
    outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_deliveries_due ON public.scheduled_deliveries (due_at)
    WHERE state IN ('pending', 'snoozed');
CREATE INDEX scheduled_deliveries_claimed ON public.scheduled_deliveries (claimed_at)
    WHERE state = 'claimed';
CREATE INDEX scheduled_deliveries_user_kind ON public.scheduled_deliveries (user_id, kind, state);
-- A producer run that finds the same situation twice cannot create a second
-- open row for it.
CREATE UNIQUE INDEX scheduled_deliveries_dedupe ON public.scheduled_deliveries (user_id, kind, dedupe_key)
    WHERE state IN ('pending', 'claimed', 'snoozed');
CREATE TRIGGER on_update_set_updated_columns_scheduled_deliveries
    BEFORE UPDATE ON public.scheduled_deliveries
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
