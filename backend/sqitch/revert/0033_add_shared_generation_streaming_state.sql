-- Revert erato:0033_add_shared_generation_streaming_state from pg

BEGIN;

DROP TABLE public.temp_chat_generation_commands;
DROP TABLE public.temp_chat_generation_events;
DROP TABLE public.temp_chat_generations;

COMMIT;
