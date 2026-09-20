-- Revert erato:0047_add_async_delivery_and_latest_generation_indexes from pg

BEGIN;

DROP INDEX IF EXISTS public.idx_chats_async_delivery_in_flight;
DROP INDEX IF EXISTS public.idx_messages_latest_generation;

COMMIT;
