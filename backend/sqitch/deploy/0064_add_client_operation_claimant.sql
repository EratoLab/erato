-- Deploy erato:0064_add_client_operation_claimant to pg
-- requires: 0062_add_client_executor_streams

BEGIN;

-- The client (browser profile or Office pane) that holds the claim. Windows of
-- one Erato desktop app installation share the sidecar binding, so the binding
-- alone no longer names the holder; NULL for claims made by older clients.
ALTER TABLE public.client_operation_attempts
    ADD COLUMN claim_claimant text DEFAULT NULL;

COMMIT;
