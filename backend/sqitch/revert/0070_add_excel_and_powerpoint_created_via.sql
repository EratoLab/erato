-- Revert erato:0070_add_excel_and_powerpoint_created_via from pg

BEGIN;

-- Before this change both panes had no value of their own.
UPDATE public.chats
SET created_via = 'office_addin'
WHERE created_via IN ('excel', 'powerpoint');

ALTER TABLE public.chats
    DROP CONSTRAINT chats_created_via_check;

ALTER TABLE public.chats
    ADD CONSTRAINT chats_created_via_check
    CHECK (created_via IN (
        'legacy', 'web', 'outlook', 'word', 'office_addin', 'ms_teams_tab', 'ms_teams_bot'
    ));

COMMIT;
