-- Deploy erato:0047_add_async_delivery_and_latest_generation_indexes to pg

BEGIN;

-- `get_generating_chats` reads each generating chat's latest generation
-- parameters through a LATERAL ordered by `created_at DESC LIMIT 1`. Only
-- `idx_messages_chat_id` served it, so Postgres read every message row of the
-- chat, filtered, and sorted, to return one row -- on an endpoint the client
-- polls every 3 seconds per open tab. Measured at 3000 messages: 1500 rows
-- sorted and 244 buffers, versus 3 buffers and no sort with this index.
--
-- The predicate mirrors the LATERAL's filter exactly, so the planner can prove
-- the implication and use the index; the DESC ordering matches its ORDER BY,
-- which is what removes the sort node.
CREATE INDEX idx_messages_latest_generation
    ON public.messages (chat_id, created_at DESC)
    WHERE is_message_in_active_thread AND generation_parameters IS NOT NULL;

-- Two delivery lookups scan `chats` by delegation provenance: the per-origin
-- `next_pending_delivery` probe, and the backstop sweep's requeue scan, which
-- has no chat to narrow by at all. Both filter the delivery state as a plain
-- conjunct, so both can use this partial index; measured on 50k delegated
-- children, each drops to a handful of rows.
--
-- Deliberately NOT written to serve `get_recent_chats.delegated_runs_in_flight`:
-- that predicate reaches the delivery state only through an OR, and a partial
-- index is usable only when the query implies its predicate, which `A OR B`
-- does not. Widening this predicate to make it match would index every async
-- child ever created and still not fix that query -- measured, it is slower.
-- See the PR body.
CREATE INDEX idx_chats_async_delivery_in_flight
    ON public.chats (origin_chat_id)
    WHERE (assistant_configuration #>> '{provenance,kind}') = 'delegation'
      AND (assistant_configuration #>> '{provenance,run_mode}') = 'async'
      AND (assistant_configuration #>> '{provenance,result_delivery,state}')
          IN ('pending', 'claimed');

COMMIT;
