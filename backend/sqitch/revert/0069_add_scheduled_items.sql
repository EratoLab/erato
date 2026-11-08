-- Revert erato:0069_add_scheduled_items from pg

BEGIN;

DROP TABLE public.scheduled_items;

COMMIT;
