-- Deploy erato:0034_add_user_tool_approval_settings to pg

BEGIN;

CREATE TABLE public.user_tool_approval_settings (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    mcp_server_id text NOT NULL,
    tool_name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deactivated_at timestamptz DEFAULT NULL,
    CONSTRAINT user_tool_approval_settings_user_server_tool_key
        UNIQUE (user_id, mcp_server_id, tool_name)
);

CREATE TRIGGER on_update_set_updated_columns_user_tool_approval_settings
    BEFORE UPDATE ON public.user_tool_approval_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
