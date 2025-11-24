#!/bin/bash

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^erato-jaeger$"; then
    echo "Jaeger container 'erato-jaeger' is already running."
    echo "UI: http://localhost:16686"
    exit 0
fi

# Stop and remove existing container if it exists
docker stop erato-jaeger 2>/dev/null || true
docker rm erato-jaeger 2>/dev/null || true

# Run Jaeger all-in-one container
# Ports:
# - 16686: UI and Query service (http)
# - 4317: OTLP gRPC
# - 4318: OTLP HTTP
# - 14250: Model (for internal use)
docker run -d \
  --name erato-jaeger \
  --rm \
  -e COLLECTOR_ZIPKIN_HOST_PORT=:9411 \
  -p 16686:16686 \
  -p 4317:4317 \
  -p 4318:4318 \
  cr.jaegertracing.io/jaegertracing/jaeger:2.12.0

echo "Jaeger container is running!"
echo "UI: http://localhost:16686"
echo "OTLP HTTP: http://localhost:4318/v1/traces"
echo "OTLP gRPC: localhost:4317"

