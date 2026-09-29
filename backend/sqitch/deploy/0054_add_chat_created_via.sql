-- Deploy erato:0054_add_chat_created_via to pg

BEGIN;

-- Which surface created the chat. Set once on creation and never changed, so
-- chat lists can be filtered by it. Chats that predate this column and cannot
-- be attributed keep 'legacy'.
ALTER TABLE public.chats
    ADD COLUMN created_via text NOT NULL DEFAULT 'legacy'
    CHECK (created_via IN (
        'legacy', 'web', 'outlook', 'word', 'office_addin', 'ms_teams_tab', 'ms_teams_bot'
    ));

-- Backfill from the platform stamped on the chat's earliest assistant message
-- that carries one. Delegated runs copy their parent's messages, so they are
-- attributed from their origin chat below instead.
WITH first_platform AS (
    SELECT DISTINCT ON (m.chat_id)
        m.chat_id,
        m.generation_parameters #>> '{request_context,platform}' AS platform
    FROM public.messages m
    WHERE m.raw_message ->> 'role' = 'assistant'
      AND m.generation_parameters #>> '{request_context,platform}' IS NOT NULL
    ORDER BY m.chat_id, m.created_at, m.id
)
UPDATE public.chats c
SET created_via = CASE
    WHEN fp.platform = 'web' THEN 'web'
    -- Early Outlook add-in builds sent the Office runtime platform instead.
    WHEN fp.platform IN ('outlook', 'PC', 'Mac', 'OfficeOnline') THEN 'outlook'
    WHEN fp.platform = 'word' THEN 'word'
    WHEN fp.platform IN ('addin-neutral', 'office-addin') THEN 'office_addin'
    -- The Teams tab and the Teams bot both stamp 'teams'. Only a chat still
    -- linked from a bot conversation, or carrying the bot's conversation
    -- context file, is known to come from the bot.
    WHEN fp.platform = 'teams' AND (
        EXISTS (
            SELECT 1 FROM public.ms_teams_conversations t
            WHERE t.current_chat_id = c.id
        )
        OR EXISTS (
            SELECT 1
            FROM public.chat_file_uploads cfu
            JOIN public.file_uploads f ON f.id = cfu.file_upload_id
            WHERE cfu.chat_id = c.id
              AND f.filename = 'teams-conversation-context.md'
        )
    ) THEN 'ms_teams_bot'
    WHEN fp.platform = 'teams' THEN 'ms_teams_tab'
    ELSE 'legacy'
END
FROM first_platform fp
WHERE fp.chat_id = c.id
  AND (c.assistant_configuration #>> '{provenance,kind}') IS DISTINCT FROM 'delegation';

-- Delegated runs inherit from the root of their delegation chain. A chain whose
-- origin chat is gone stays 'legacy'.
WITH RECURSIVE lineage AS (
    SELECT c.id, c.origin_chat_id AS ancestor_id, 1 AS depth
    FROM public.chats c
    WHERE (c.assistant_configuration #>> '{provenance,kind}') = 'delegation'
      AND c.origin_chat_id IS NOT NULL
    UNION ALL
    SELECT l.id, p.origin_chat_id, l.depth + 1
    FROM lineage l
    JOIN public.chats p ON p.id = l.ancestor_id
    WHERE (p.assistant_configuration #>> '{provenance,kind}') = 'delegation'
      AND p.origin_chat_id IS NOT NULL
      AND l.depth < 64
),
roots AS (
    SELECT DISTINCT ON (l.id) l.id, r.created_via
    FROM lineage l
    JOIN public.chats r ON r.id = l.ancestor_id
    WHERE (r.assistant_configuration #>> '{provenance,kind}') IS DISTINCT FROM 'delegation'
    ORDER BY l.id, l.depth
)
UPDATE public.chats c
SET created_via = roots.created_via
FROM roots
WHERE roots.id = c.id;

COMMIT;
