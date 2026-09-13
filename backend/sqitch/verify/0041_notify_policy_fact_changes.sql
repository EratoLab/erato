BEGIN;
SELECT 1 / COUNT(*) FROM pg_proc WHERE oid = 'public.notify_policy_facts_changed()'::regprocedure;
SELECT 1 / (COUNT(*) = 8)::int FROM pg_trigger WHERE tgname = 'policy_facts_changed' AND NOT tgisinternal;
ROLLBACK;
