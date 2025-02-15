-- Deploy erato:0003_add_users_table to pg

BEGIN;

-- Chats table
CREATE TABLE users (
                       id UUID PRIMARY KEY DEFAULT uuidv7(),
                       issuer TEXT NOT NULL,
                       subject TEXT NOT NULL,
                       email TEXT,
                       created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                       updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TRIGGER on_update_set_updated_columns
    BEFORE UPDATE ON users
    FOR each ROW EXECUTE PROCEDURE set_updated_at_column();

CREATE UNIQUE INDEX idx_users_issuer_subject ON users (issuer, subject);

COMMENT ON COLUMN users.issuer IS 'The identity provider (IdP) that authenticated the user (e.g., ''https://login.microsoftonline.com/'', ''https://accounts.google.com'')';
COMMENT ON COLUMN users.subject IS 'The unique identifier for the user at the IdP (usually a UUID or similar)';
COMMENT ON COLUMN users.email IS 'The user''s email address (optional, as not all IdPs may provide it)';

COMMIT;
