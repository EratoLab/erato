-- Verify erato:0022_add_mcp_server_oauth_tables on pg

BEGIN;

SELECT
    mcp_server_id,
    client_id,
    client_secret_encrypted,
    redirect_uri,
    registration_metadata
FROM public.mcp_server_oauth_clients
WHERE FALSE;

SELECT
    user_id,
    mcp_server_id,
    credentials_encrypted,
    last_used_at
FROM public.mcp_server_oauth_credentials
WHERE FALSE;

SELECT
    user_id,
    mcp_server_id,
    csrf_token,
    state_encrypted
FROM public.mcp_server_oauth_authorization_states
WHERE FALSE;

ROLLBACK;
