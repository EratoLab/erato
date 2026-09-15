-- Deploy erato:0043_add_mcp_write_tools_enabled_to_chats to pg

BEGIN;

ALTER TABLE public.chats
    ADD COLUMN mcp_write_tools_enabled boolean NOT NULL DEFAULT true;

COMMIT;
