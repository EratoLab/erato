-- Deploy erato:0029_add_assistant_hub_reviews to pg

BEGIN;

CREATE TABLE public.assistant_hub_reviews (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    assistant_hub_assistant_id uuid NOT NULL,
    assistant_hub_assistant_version_id uuid NOT NULL,
    reviewer_user_id uuid NOT NULL,
    score integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_hub_reviews_score_check CHECK (score >= 1 AND score <= 10)
);

ALTER TABLE ONLY public.assistant_hub_reviews
    ADD CONSTRAINT assistant_hub_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assistant_hub_reviews
    ADD CONSTRAINT assistant_hub_reviews_assistant_reviewer_key UNIQUE (assistant_hub_assistant_id, reviewer_user_id);

ALTER TABLE ONLY public.assistant_hub_reviews
    ADD CONSTRAINT assistant_hub_reviews_hub_assistant_id_fkey FOREIGN KEY (assistant_hub_assistant_id) REFERENCES public.assistant_hub_assistants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assistant_hub_reviews
    ADD CONSTRAINT assistant_hub_reviews_version_id_fkey FOREIGN KEY (assistant_hub_assistant_version_id) REFERENCES public.assistant_hub_assistant_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assistant_hub_reviews
    ADD CONSTRAINT assistant_hub_reviews_reviewer_user_id_fkey FOREIGN KEY (reviewer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX idx_assistant_hub_reviews_hub_assistant_id ON public.assistant_hub_reviews USING btree (assistant_hub_assistant_id);
CREATE INDEX idx_assistant_hub_reviews_version_id ON public.assistant_hub_reviews USING btree (assistant_hub_assistant_version_id);
CREATE INDEX idx_assistant_hub_reviews_reviewer_user_id ON public.assistant_hub_reviews USING btree (reviewer_user_id);

CREATE TRIGGER on_update_set_updated_columns_assistant_hub_reviews BEFORE UPDATE ON public.assistant_hub_reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

COMMIT;
