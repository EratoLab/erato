#!/bin/bash

# Create azurite data directory if it doesn't exist
mkdir -p azurite_data

# Default container name and credentials
DEFAULT_CONTAINER="erato-storage"
APP_ACCOUNT_NAME="devstoreaccount1"
APP_ACCOUNT_KEY="Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=="

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^erato-azurite$"; then
    echo "Azurite container 'erato-azurite' is already running."
    echo "Connection details:"
    echo "  Blob Endpoint: http://localhost:10000/$APP_ACCOUNT_NAME"
    echo "  Queue Endpoint: http://localhost:10001/$APP_ACCOUNT_NAME"
    echo "  Table Endpoint: http://localhost:10002/$APP_ACCOUNT_NAME"
    echo "  Account Name: $APP_ACCOUNT_NAME"
    echo "  Account Key: $APP_ACCOUNT_KEY"
    echo "  Default container: $DEFAULT_CONTAINER"
    echo
    echo "To create a container:"
    echo "  az storage container create --name $DEFAULT_CONTAINER --connection-string \"DefaultEndpointsProtocol=http;AccountName=$APP_ACCOUNT_NAME;AccountKey=$APP_ACCOUNT_KEY;BlobEndpoint=http://localhost:10000/$APP_ACCOUNT_NAME;\""
    exit 0
fi

# Stop and remove existing container if it exists
docker stop erato-azurite 2>/dev/null || true
docker rm erato-azurite 2>/dev/null || true

# Check if ports 10000, 10001, and 10002 are already in use
if lsof -i :10000 >/dev/null 2>&1; then
    echo "Error: Port 10000 is already in use. Please stop any other services first."
    exit 1
fi

if lsof -i :10001 >/dev/null 2>&1; then
    echo "Error: Port 10001 is already in use. Please stop any other services first."
    exit 1
fi

if lsof -i :10002 >/dev/null 2>&1; then
    echo "Error: Port 10002 is already in use. Please stop any other services first."
    exit 1
fi

# Run Azurite container
docker run -d \
  --name erato-azurite \
  -v "$(pwd)/azurite_data:/data" \
  -p 10000:10000 \
  -p 10001:10001 \
  -p 10002:10002 \
  mcr.microsoft.com/azure-storage/azurite:3.34.0 \
  azurite --blobHost 0.0.0.0 --queueHost 0.0.0.0 --tableHost 0.0.0.0 --location /data --debug /data/debug.log

# Wait for Azurite to be ready
echo "Waiting for Azurite to start..."
sleep 5

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Azure CLI (az) is not installed."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "On macOS, you can install it using Homebrew:"
        echo "    brew install azure-cli"
        echo ""
    else
        echo "You can install it on Linux using:"
        echo "    curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash"
        echo ""
    fi
    
    echo "Continuing without Azure CLI. You can still use the connection string manually."
else
    # Create the default container if it doesn't exist
    echo "Creating default container: $DEFAULT_CONTAINER"
    az storage container create --name $DEFAULT_CONTAINER \
      --connection-string "DefaultEndpointsProtocol=http;AccountName=$APP_ACCOUNT_NAME;AccountKey=$APP_ACCOUNT_KEY;BlobEndpoint=http://localhost:10000/$APP_ACCOUNT_NAME;" \
      --public-access off || echo "Failed to create container. The Azure CLI may not be configured correctly."
fi

# Connection string for OpenDAL
CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=$APP_ACCOUNT_NAME;AccountKey=$APP_ACCOUNT_KEY;BlobEndpoint=http://localhost:10000/$APP_ACCOUNT_NAME;"

echo "Azurite container is running!"
echo "Connection details:"
echo "  Blob Endpoint: http://localhost:10000/$APP_ACCOUNT_NAME"
echo "  Queue Endpoint: http://localhost:10001/$APP_ACCOUNT_NAME"
echo "  Table Endpoint: http://localhost:10002/$APP_ACCOUNT_NAME"
echo "  Account Name: $APP_ACCOUNT_NAME"
echo "  Account Key: $APP_ACCOUNT_KEY"
echo "  Default container: $DEFAULT_CONTAINER"
echo
echo "Connection String:"
echo "  $CONNECTION_STRING"
echo
echo "Example OpenDAL usage in Rust:"
echo "  let op = Operator::via_azblob(|builder| {"
echo "      builder.from_connection_string(\"$CONNECTION_STRING\")"
echo "          .container(\"$DEFAULT_CONTAINER\")"
echo "  })?"
echo
echo "Example Azure CLI commands:"
echo "  List containers:          az storage container list --connection-string \"$CONNECTION_STRING\""
echo "  List blobs in container:  az storage blob list --container-name $DEFAULT_CONTAINER --connection-string \"$CONNECTION_STRING\""
echo "  Upload a blob:            az storage blob upload --container-name $DEFAULT_CONTAINER --name myblob.txt --file ./myfile.txt --connection-string \"$CONNECTION_STRING\""
echo "  Download a blob:          az storage blob download --container-name $DEFAULT_CONTAINER --name myblob.txt --file ./downloaded.txt --connection-string \"$CONNECTION_STRING\""
echo "  Delete a blob:            az storage blob delete --container-name $DEFAULT_CONTAINER --name myblob.txt --connection-string \"$CONNECTION_STRING\""
echo
echo "For more commands:          az storage blob --help" 