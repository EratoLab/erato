-- Deploy erato:0039_add_starting_assistant_to_user_preferences to pg

BEGIN;

-- The start-screen override is tri-state: never set (inherit any audience
-- pin), explicitly cleared, or an own pick. One nullable column cannot express
-- that, so the clear gets its own flag.
--
-- A pick is one of two kinds, in two columns rather than one polymorphic id.
-- A hub pick stores `assistant_hub_assistants.id`, which is stable across
-- republishes, never the clone's `assistants.id`, which is minted fresh every
-- time. A pick of an assistant that was never published to the hub has no hub
-- row to point at, so it stores `assistants.id` directly — stable, because
-- nothing clones it.
ALTER TABLE public.user_preferences
    ADD COLUMN starting_hub_assistant_id uuid DEFAULT NULL
        REFERENCES public.assistant_hub_assistants (id) ON DELETE SET NULL,
    ADD COLUMN starting_assistant_id uuid DEFAULT NULL
        REFERENCES public.assistants (id) ON DELETE SET NULL,
    ADD COLUMN starting_assistant_cleared boolean NOT NULL DEFAULT false,
    -- A row can never be both cleared and picked. ON DELETE SET NULL only ever
    -- fires on a (pick, false) row, which lands on (NULL, false) = inherit.
    ADD CONSTRAINT user_preferences_starting_assistant_state_check
        CHECK (NOT (starting_assistant_cleared
            AND (starting_hub_assistant_id IS NOT NULL
                OR starting_assistant_id IS NOT NULL))),
    -- One pick at a time: the two columns are alternatives, not a pair.
    ADD CONSTRAINT user_preferences_starting_assistant_single_pick_check
        CHECK (starting_hub_assistant_id IS NULL OR starting_assistant_id IS NULL);

COMMIT;
