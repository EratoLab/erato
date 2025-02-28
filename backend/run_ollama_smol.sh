#!/bin/bash

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^erato-ollama-smol$"; then
    echo "Ollama container 'erato-ollama-smol' is already running."
    echo "API endpoint: http://localhost:12434"
    echo
    echo "Example chat completion request:"
    echo "curl http://localhost:12434/v1/chat/completions \\"
    echo "    -H \"Content-Type: application/json\" \\"
    echo "    -d '{"
    echo "        \"model\": \"smollm2:135m\","
    echo "        \"messages\": ["
    echo "            {"
    echo "                \"role\": \"user\","
    echo "                \"content\": \"Hello!\""
    echo "            }"
    echo "        ]"
    echo "    }'"
    exit 0
fi

# Stop and remove existing container if it exists
docker stop erato-ollama-smol 2>/dev/null || true
docker rm erato-ollama-smol 2>/dev/null || true

# Check if port 12434 is already in use
if lsof -i :12434 >/dev/null 2>&1; then
    echo "Error: Port 12434 is already in use. Please stop any other Ollama instances first."
    exit 1
fi

# Run Ollama container
docker run -d \
  --name erato-ollama-smol \
  --rm \
  -p 12434:11434 \
  harbor.imassage.me/erato/ollama-smol:47bfa34ad02fd643fc00a794c5fabf74ce94402a

echo "Ollama container is running!"
echo "API endpoint: http://localhost:12434"
echo
echo "Example chat completion request:"
echo "curl http://localhost:12434/v1/chat/completions \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{"
echo "        \"model\": \"smollm2:135m\","
echo "        \"messages\": ["
echo "            {"
echo "                \"role\": \"user\","
echo "                \"content\": \"Hello!\""
echo "            }"
echo "        ]"
echo "    }'" 