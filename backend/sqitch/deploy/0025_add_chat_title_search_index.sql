-- Deploy erato:0025_add_chat_title_search_index to pg

BEGIN;

CREATE INDEX idx_chats_resolved_title_search
    ON public.chats
    USING gin (
        to_tsvector(
            'simple'::regconfig,
            COALESCE(
                NULLIF(BTRIM(title_by_user_provided), ''),
                NULLIF(BTRIM(title_by_summary), ''),
                'Untitled Chat'
            )
        )
    );

COMMIT;
