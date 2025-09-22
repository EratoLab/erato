-- Revert erato:0010_add_view_user_daily_token_usage from pg

BEGIN;

-- Drop the user daily token usage view
DROP VIEW IF EXISTS user_daily_token_usage;

COMMIT;
