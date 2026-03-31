-- Verify erato:0021_add_input_parameters_to_messages on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'messages'
  AND column_name = 'input_parameters'
  AND data_type = 'jsonb'
  AND is_nullable = 'YES';

ROLLBACK;
