#!/bin/bash

set -euo pipefail

CONTAINER_NAME="erato-seaweedfs"
DATA_DIR="seaweedfs_data"
ACCESS_KEY="admin"
SECRET_KEY="admin"

mkdir -p "${DATA_DIR}"

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "SeaweedFS container '${CONTAINER_NAME}' is already running."
    echo "Connection details:"
    echo "  S3 API Endpoint: http://localhost:8333"
    echo "  Filer UI: http://localhost:8888"
    echo "  Access Key: ${ACCESS_KEY}"
    echo "  Secret Key: ${SECRET_KEY}"
    exit 0
fi

docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm "${CONTAINER_NAME}" 2>/dev/null || true

for port in 8333 8888 9333 9340 7333 23646; do
    if lsof -i :"${port}" >/dev/null 2>&1; then
        echo "Error: Port ${port} is already in use. Please stop the conflicting service first."
        exit 1
    fi
done

docker run -d \
  --name "${CONTAINER_NAME}" \
  -e AWS_ACCESS_KEY_ID="${ACCESS_KEY}" \
  -e AWS_SECRET_ACCESS_KEY="${SECRET_KEY}" \
  -v "$(pwd)/${DATA_DIR}:/data" \
  -p 8333:8333 \
  -p 8888:8888 \
  -p 9333:9333 \
  -p 9340:9340 \
  -p 7333:7333 \
  -p 23646:23646 \
  chrislusf/seaweedfs:4.08 \
  mini -dir=/data

echo "Waiting for SeaweedFS to start..."
sleep 3

echo "SeaweedFS container is running!"
echo "Connection details:"
echo "  S3 API Endpoint: http://localhost:8333"
echo "  Filer UI: http://localhost:8888"
echo "  Access Key: ${ACCESS_KEY}"
echo "  Secret Key: ${SECRET_KEY}"
