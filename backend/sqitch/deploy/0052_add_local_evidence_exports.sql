-- Deploy erato:0052_add_local_evidence_exports to pg
BEGIN;
CREATE TABLE public.local_evidence_exports (
    attempt_id uuid PRIMARY KEY REFERENCES public.client_operation_attempts(attempt_id) ON DELETE CASCADE,
    binding jsonb NOT NULL,
    origin text NOT NULL,
    plan jsonb NOT NULL,
    receipt text,
    export_id text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((receipt IS NULL) = (export_id IS NULL))
);
CREATE TRIGGER on_update_set_updated_columns_local_evidence_exports
    BEFORE UPDATE ON public.local_evidence_exports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();
COMMENT ON TABLE public.local_evidence_exports IS 'Native immutable binding and durable acknowledgement receipt. No job lifecycle, generation checkpoint, native handles/statuses, or credentials.';
COMMIT;
