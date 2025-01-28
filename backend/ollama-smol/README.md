## ollama-smol 

This is a Docker image for running Ollama with the [smollm2 135m](https://ollama.com/library/smollm2) as an LLM model and the [nomic-embed-text embedding model](https://ollama.com/library/nomic-embed-text:137m-v1.5-fp16).

This can be used as a "slim" local LLM for testing and development.

## Building

```
just build
```

## Running

```
just run
```

## Sending requests

[Full docs for the OpenAI API compatibility.](https://github.com/ollama/ollama/blob/2ef3c803a151a0a9b1776c9ebe6a7e86b3971660/docs/openai.md)

Example OpenAI API request (the `smollm2:135m` model is used):

```sh
curl http://localhost:11434/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "smollm2:135m",
        "messages": [
            {
                "role": "user",
                "content": "Hello!"
            }
        ]
    }'
```

Example embedding request:

```sh
curl http://localhost:11434/v1/embeddings \
    -H "Content-Type: application/json" \
    -d '{
        "model": "nomic-embed-text:137m-v1.5-fp16",
        "input": ["why is the sky blue?", "why is the grass green?"]
    }'
```