-- Deploy erato:0022_add_mcp_server_oauth_tables to pg

BEGIN;

CREATE TABLE public.mcp_server_oauth_clients (
    mcp_server_id text PRIMARY KEY,
    client_id text NOT NULL,
    client_secret_encrypted text DEFAULT NULL,
    redirect_uri text NOT NULL,
    registration_metadata jsonb DEFAULT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TRIGGER on_update_set_updated_columns_mcp_server_oauth_clients
    BEFORE UPDATE ON public.mcp_server_oauth_clients
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at_column();

CREATE TABLE public.mcp_server_oauth_credentials (
    user_id uuid NOT NULL,
    mcp_server_id text NOT NULL,
    credentials_encrypted text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT NULL,
    CONSTRAINT mcp_server_oauth_credentials_pkey PRIMARY KEY (user_id, mcp_server_id),
    CONSTRAINT mcp_server_oauth_credentials_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users (id)
        ON DELETE CASCADE
);

CREATE TRIGGER on_update_set_updated_columns_mcp_server_oauth_credentials
    BEFORE UPDATE ON public.mcp_server_oauth_credentials
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at_column();

CREATE TABLE public.mcp_server_oauth_authorization_states (
    user_id uuid NOT NULL,
    mcp_server_id text NOT NULL,
    csrf_token text NOT NULL,
    state_encrypted text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mcp_server_oauth_authorization_states_pkey
        PRIMARY KEY (user_id, mcp_server_id, csrf_token),
    CONSTRAINT mcp_server_oauth_authorization_states_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users (id)
        ON DELETE CASCADE
);

CREATE TRIGGER on_update_set_updated_columns_mcp_server_oauth_authorization_states
    BEFORE UPDATE ON public.mcp_server_oauth_authorization_states
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
