BEGIN;
SELECT welcome_message, starter_prompts FROM assistants WHERE false;
ROLLBACK;
