-- Deploy erato:0070_add_excel_and_powerpoint_created_via to pg
-- requires: 0069_add_scheduled_items

BEGIN;

ALTER TABLE public.chats
    DROP CONSTRAINT chats_created_via_check;

ALTER TABLE public.chats
    ADD CONSTRAINT chats_created_via_check
    CHECK (created_via IN (
        'legacy', 'web', 'outlook', 'word', 'excel', 'powerpoint',
        'office_addin', 'ms_teams_tab', 'ms_teams_bot'
    ));

COMMIT;
