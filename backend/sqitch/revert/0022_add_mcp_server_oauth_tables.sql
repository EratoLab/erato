-- Revert erato:0022_add_mcp_server_oauth_tables from pg

BEGIN;

DROP TABLE public.mcp_server_oauth_authorization_states;
DROP TABLE public.mcp_server_oauth_credentials;
DROP TABLE public.mcp_server_oauth_clients;

COMMIT;
