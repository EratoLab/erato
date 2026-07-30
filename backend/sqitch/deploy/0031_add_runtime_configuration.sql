-- Deploy erato:0031_add_runtime_configuration to pg

BEGIN;

CREATE TABLE public.runtime_configuration (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    source_service text NOT NULL,
    source_filename text DEFAULT NULL,
    config text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_configuration_pkey PRIMARY KEY (id)
);

CREATE INDEX runtime_configuration_source_service_idx
    ON public.runtime_configuration (source_service);

CREATE TRIGGER on_update_set_updated_columns_runtime_configuration
    BEFORE UPDATE ON public.runtime_configuration
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
