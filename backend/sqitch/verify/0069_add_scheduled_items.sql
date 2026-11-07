-- Verify erato:0069_add_scheduled_items on pg

BEGIN;

SELECT id, user_id, kind, name, message, linked_chat_id, channel, trigger, time_zone,
       status, occurrence_at, occurrence_count, origin, created_at, updated_at
FROM public.scheduled_items WHERE FALSE;

ROLLBACK;
