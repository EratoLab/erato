#!/bin/bash

# Create postgres data directory if it doesn't exist
mkdir -p postgres_data

# Stop and remove existing container if it exists
docker stop dagster-postgres 2>/dev/null || true
docker rm dagster-postgres 2>/dev/null || true

# Check if port 5432 is already in use
if lsof -i :5432 >/dev/null 2>&1; then
    echo "Error: Port 5432 is already in use. Please stop any other PostgreSQL instances first."
    exit 1
fi

# Run PostgreSQL container
docker run -d \
  --name llmchat-postgres \
  -e POSTGRES_USER=llmchatuser \
  -e POSTGRES_PASSWORD=llmchatpw \
  -e POSTGRES_DB=llmchat \
  -v "$(pwd)/postgres_data:/var/lib/postgresql/data" \
  -p 5432:5432 \
  postgres:17.2

echo "PostgreSQL container is running!"
echo "Connection details:"
echo "  Host: localhost"
echo "  Port: 5432"
echo "  User: llmchatuser"
echo "  Password: llmchatpw"
echo "  Database: llmchat"
echo
echo "Connection string:"
echo "  postgresql://llmchatuser:llmchatpw@localhost:5432/llmchat" 
