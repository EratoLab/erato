-- Deploy erato:0002_add_chat_and_messages_tables to pg

BEGIN;

-- Portable uuidv7 generation function from dverite/postgres-uuidv7-sql
/* Main function to generate a uuidv7 value with millisecond precision */
CREATE FUNCTION uuidv7(timestamptz DEFAULT clock_timestamp()) RETURNS uuid
AS $$
  -- Replace the first 48 bits of a uuidv4 with the current
  -- number of milliseconds since 1970-01-01 UTC
  -- and set the "ver" field to 7 by setting additional bits
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid()) placing
	  substring(int8send((extract(epoch from $1)*1000)::bigint) from 3)
	  from 1 for 6),
	52, 1),
      53, 1), 'hex')::uuid;
$$ LANGUAGE sql volatile parallel safe;

-- General updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at_column()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Chats table
CREATE TABLE chats (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    owner_user_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TRIGGER on_update_set_updated_columns
BEFORE UPDATE ON chats
FOR each ROW EXECUTE PROCEDURE set_updated_at_column();

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    chat_id UUID NOT NULL REFERENCES chats(id),
    order_index INTEGER NOT NULL,
    raw_message JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TRIGGER on_update_set_updated_columns
BEFORE UPDATE ON messages
FOR each ROW EXECUTE PROCEDURE set_updated_at_column();

CREATE INDEX idx_messages_chat_id ON messages (chat_id);

COMMIT;
