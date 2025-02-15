-- Revert erato:0003_add_users_table from pg

BEGIN;

COMMENT ON COLUMN users.email IS NULL;
COMMENT ON COLUMN users.subject IS NULL;
COMMENT ON COLUMN users.issuer IS NULL;

DROP TABLE users;

COMMIT;
