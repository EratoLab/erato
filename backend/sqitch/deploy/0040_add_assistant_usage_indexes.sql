BEGIN;
CREATE INDEX idx_chats_assistant_usage ON public.chats (assistant_id, id) INCLUDE (owner_user_id) WHERE assistant_id IS NOT NULL;
CREATE INDEX idx_messages_assistant_usage ON public.messages (chat_id, created_at) WHERE raw_message->>'role' = 'assistant' AND generation_metadata IS NOT NULL;
COMMIT;
