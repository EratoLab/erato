-- Emit targeted invalidations only at commit, including cascaded deletes.
-- No revision table, counters, or per-read database checks.
BEGIN;
CREATE FUNCTION public.notify_policy_facts_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    old_row jsonb;
    new_row jsonb;
    old_id uuid;
    new_id uuid;
    field_name text;
    changed boolean := TG_OP <> 'UPDATE';
BEGIN
    IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
    IF TG_OP = 'UPDATE' THEN
        FOREACH field_name IN ARRAY TG_ARGV[2:TG_NARGS-1] LOOP
            changed := changed OR (old_row -> field_name IS DISTINCT FROM new_row -> field_name);
        END LOOP;
    END IF;
    IF NOT changed THEN RETURN NULL; END IF;

    -- Only assistant grants and chat share links participate in this policy.
    IF TG_ARGV[0] NOT IN ('grants', 'links') OR
       old_row ->> 'resource_type' = (CASE TG_ARGV[0] WHEN 'grants' THEN 'assistant' ELSE 'chat' END) THEN
        old_id := (old_row ->> TG_ARGV[1])::uuid;
    END IF;
    IF TG_ARGV[0] NOT IN ('grants', 'links') OR
       new_row ->> 'resource_type' = (CASE TG_ARGV[0] WHEN 'grants' THEN 'assistant' ELSE 'chat' END) THEN
        new_id := (new_row ->> TG_ARGV[1])::uuid;
    END IF;
    -- PostgreSQL delivers NOTIFY only after commit, and discards it on rollback.
    -- Invalidate old/new association keys together without storing revisions.
    IF old_id IS NOT NULL OR new_id IS NOT NULL THEN
        PERFORM pg_notify('policy_facts_changed', (
            SELECT jsonb_agg(jsonb_build_array(TG_ARGV[0], id))::text
            FROM (SELECT DISTINCT unnest(ARRAY[old_id, new_id]) AS id) AS ids
            WHERE id IS NOT NULL
        ));
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.chats
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('chat', 'id', 'id', 'owner_user_id', 'archived_at');
CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.assistants
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('assistant', 'id', 'id', 'owner_user_id');
CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.file_uploads
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('file', 'id', 'id', 'owner_user_id');
CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.chat_file_uploads
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('associations', 'file_upload_id', 'file_upload_id', 'chat_id');
CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.assistant_file_uploads
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('associations', 'file_upload_id', 'file_upload_id', 'assistant_id');
CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.share_grants
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('grants', 'resource_id', 'resource_type', 'resource_id', 'subject_type', 'subject_id_type', 'subject_id', 'role');
CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.share_links
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('links', 'resource_id', 'resource_type', 'resource_id', 'enabled');
CREATE TRIGGER policy_facts_changed AFTER INSERT OR UPDATE OR DELETE ON public.assistant_hub_assistant_versions
FOR EACH ROW EXECUTE FUNCTION public.notify_policy_facts_changed('hub', 'assistant_id', 'assistant_id', 'status', 'is_published', 'is_current_published_version');

COMMIT;
