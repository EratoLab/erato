-- Deploy erato:0055_add_client_tool_decisions to pg
BEGIN;
ALTER TABLE public.user_preferences ADD COLUMN client_tool_decisions jsonb DEFAULT '{}'::jsonb NOT NULL
    CHECK (jsonb_typeof(client_tool_decisions) = 'object');
COMMIT;
