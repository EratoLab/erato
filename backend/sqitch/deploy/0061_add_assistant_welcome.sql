BEGIN;
ALTER TABLE assistants ADD COLUMN welcome_message text, ADD COLUMN starter_prompts jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
