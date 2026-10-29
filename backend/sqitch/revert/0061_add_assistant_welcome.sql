BEGIN;
ALTER TABLE assistants DROP COLUMN welcome_message, DROP COLUMN starter_prompts;
COMMIT;
