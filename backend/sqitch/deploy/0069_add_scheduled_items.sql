-- Deploy erato:0069_add_scheduled_items to pg
-- requires: 0068_add_user_time_zone_and_language

BEGIN;

-- What a user scheduled (a reminder now, a scheduled task later): one row per
-- entry on the Scheduled page. Each time it is due, an occurrence row in
-- scheduled_deliveries (same kind, dedupe_key = the item id) carries it; the
-- dedupe index keeps that to one open occurrence per item, and a repeating
-- item gets its next occurrence once the current one is settled.
CREATE TABLE public.scheduled_items (
    id uuid PRIMARY KEY DEFAULT public.uuidv7(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    name text NOT NULL,
    message text NOT NULL DEFAULT '',
    linked_chat_id uuid REFERENCES public.chats(id) ON DELETE SET NULL,
    channel text NOT NULL,
    trigger jsonb NOT NULL,
    -- The IANA zone the trigger's local times were entered in, kept with the
    -- item so a later change of the user's zone does not move it.
    time_zone text NOT NULL,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'ended', 'cancelled')),
    -- The regular (unsnoozed) time of the latest occurrence, from which the
    -- next one is computed, and how many occurrences there were.
    occurrence_at timestamptz,
    occurrence_count integer NOT NULL DEFAULT 0,
    origin jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_items_user ON public.scheduled_items (user_id, status);
CREATE INDEX scheduled_items_active ON public.scheduled_items (kind)
    WHERE status = 'active';
CREATE TRIGGER on_update_set_updated_columns_scheduled_items
    BEFORE UPDATE ON public.scheduled_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
