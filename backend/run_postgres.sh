#!/bin/bash

# Create postgres data directory if it doesn't exist
mkdir -p postgres_data

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^erato-postgres$"; then
    echo "PostgreSQL container 'erato-postgres' is already running."
    echo "Connection details:"
    echo "  Host: localhost"
    echo "  Port: 5432"
    echo "  User: eratouser"
    echo "  Password: eratopw"
    echo "  Database: erato"
    echo
    echo "Connection string:"
    echo "  postgresql://eratouser:eratopw@localhost:5432/erato"
    exit 0
fi

# Stop and remove existing container if it exists
docker stop erato-postgres 2>/dev/null || true
docker rm erato-postgres 2>/dev/null || true

# Check if port 5432 is already in use
if lsof -i :5432 >/dev/null 2>&1; then
    echo "Error: Port 5432 is already in use. Please stop any other PostgreSQL instances first."
    exit 1
fi

# Run PostgreSQL container
docker run -d \
  --name erato-postgres \
  --rm \
  -e POSTGRES_USER=eratouser \
  -e POSTGRES_PASSWORD=eratopw \
  -e POSTGRES_DB=erato \
  -v "$(pwd)/postgres_data:/var/lib/postgresql/data" \
  -p 5432:5432 \
  postgres:17.2

echo "PostgreSQL container is running!"
echo "Connection details:"
echo "  Host: localhost"
echo "  Port: 5432"
echo "  User: eratouser"
echo "  Password: eratopw"
echo "  Database: erato"
echo
echo "Connection string:"
echo "  postgresql://eratouser:eratopw@localhost:5432/erato" 
