-- Deploy erato:0039_add_starting_assistant_to_user_preferences to pg

BEGIN;

-- The start-screen override is tri-state: never set (inherit any audience
-- pin), explicitly cleared, or an own pick. One nullable column cannot express
-- that, so the clear gets its own flag. The pick references
-- `assistant_hub_assistants.id`, which is stable across republishes, never
-- `assistants.id`, which is minted fresh on every republish.
ALTER TABLE public.user_preferences
    ADD COLUMN starting_hub_assistant_id uuid DEFAULT NULL
        REFERENCES public.assistant_hub_assistants (id) ON DELETE SET NULL,
    ADD COLUMN starting_assistant_cleared boolean NOT NULL DEFAULT false,
    -- A row can never be both cleared and picked. ON DELETE SET NULL only ever
    -- fires on a (pick, false) row, which lands on (NULL, false) = inherit.
    ADD CONSTRAINT user_preferences_starting_assistant_state_check
        CHECK (NOT (starting_assistant_cleared AND starting_hub_assistant_id IS NOT NULL));

COMMIT;
