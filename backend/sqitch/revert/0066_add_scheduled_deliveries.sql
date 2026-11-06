-- Revert erato:0066_add_scheduled_deliveries from pg

BEGIN;

DROP TABLE public.scheduled_deliveries;

COMMIT;
