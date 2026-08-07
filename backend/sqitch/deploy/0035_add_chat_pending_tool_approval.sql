-- Deploy erato:0035_add_chat_pending_tool_approval to pg

BEGIN;

-- Durable "awaiting tool approval" marker: set when a generation stops on an
-- MCP approval request, cleared when the decision is made or a later
-- generation completes. Unlike generation_state it has no heartbeat and no
-- retention window — a parked chat stays marked until the user decides.
ALTER TABLE public.chats
    ADD COLUMN pending_tool_approval_at timestamptz DEFAULT NULL;

COMMIT;
