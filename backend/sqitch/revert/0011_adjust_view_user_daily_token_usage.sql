-- Revert erato:0011_adjust_view_user_daily_token_usage from pg

BEGIN;

-- Drop the adjusted view
DROP VIEW IF EXISTS user_daily_token_usage;

-- Recreate the original view without chat provider grouping
CREATE VIEW user_daily_token_usage AS
SELECT 
    c.owner_user_id AS user_id,
    DATE(m.created_at) AS usage_date,
    COUNT(*) AS total_messages,
    SUM(COALESCE((m.generation_metadata->>'used_prompt_tokens')::INTEGER, 0)) AS total_prompt_tokens,
    SUM(COALESCE((m.generation_metadata->>'used_completion_tokens')::INTEGER, 0)) AS total_completion_tokens,
    SUM(COALESCE((m.generation_metadata->>'used_total_tokens')::INTEGER, 0)) AS total_tokens,
    SUM(COALESCE((m.generation_metadata->>'used_reasoning_tokens')::INTEGER, 0)) AS total_reasoning_tokens
FROM messages m
JOIN chats c ON m.chat_id = c.id
WHERE m.generation_metadata IS NOT NULL
  AND m.generation_metadata ? 'used_total_tokens'
GROUP BY c.owner_user_id, DATE(m.created_at)
ORDER BY usage_date DESC, user_id;

COMMIT;
