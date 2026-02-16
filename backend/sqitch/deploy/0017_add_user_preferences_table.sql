-- Deploy erato:0017_add_user_preferences_table to pg

BEGIN;

CREATE TABLE public.user_preferences (
    user_id uuid PRIMARY KEY,
    nickname text DEFAULT NULL,
    job_title text DEFAULT NULL,
    assistant_custom_instructions text DEFAULT NULL,
    assistant_additional_information text DEFAULT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_preferences_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users (id)
        ON DELETE CASCADE
);

CREATE TRIGGER set_updated_at_column
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
