-- Deploy erato:0048_add_client_tool_file_approval to pg
BEGIN;
ALTER TABLE public.user_preferences ADD COLUMN client_tool_file_approval text
    CHECK (client_tool_file_approval IN ('never_allow', 'ask', 'always_allow'));
COMMIT;
