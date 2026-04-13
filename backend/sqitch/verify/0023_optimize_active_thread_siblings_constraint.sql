-- Verify erato:0023_optimize_active_thread_siblings_constraint on pg

BEGIN;

SELECT pg_get_functiondef('public.check_active_thread_siblings_constraint()'::regprocedure);

ROLLBACK;
