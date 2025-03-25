#!/bin/bash

# Create minio data directory if it doesn't exist
mkdir -p minio_data

# Default bucket name and access keys
DEFAULT_BUCKET="erato-storage"
APP_ACCESS_KEY="erato-app-user"
APP_SECRET_KEY="erato-app-password"

# Function to check if mc is installed
check_mc_installed() {
    if command -v mc &> /dev/null; then
        return 0 # mc is installed
    else
        return 1 # mc is not installed
    fi
}

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^erato-minio$"; then
    echo "MinIO container 'erato-minio' is already running."
    echo "Connection details:"
    echo "  S3 API Endpoint: http://localhost:9000"
    echo "  Console: http://localhost:9001"
    echo "  Root Access Key: eratouser"
    echo "  Root Secret Key: eratopassword"
    echo
    echo "App credentials:"
    echo "  Access Key: $APP_ACCESS_KEY"
    echo "  Secret Key: $APP_SECRET_KEY"
    echo "  Default bucket: $DEFAULT_BUCKET"
    echo
    echo "To use MinIO Client (mc):"
    echo "  mc ls local"
    echo "  mc cp file.txt local/$DEFAULT_BUCKET/"
    echo "  mc cat local/$DEFAULT_BUCKET/file.txt"
    exit 0
fi

# Stop and remove existing container if it exists
docker stop erato-minio 2>/dev/null || true
docker rm erato-minio 2>/dev/null || true

# Check if ports 9000 and 9001 are already in use
if lsof -i :9000 >/dev/null 2>&1; then
    echo "Error: Port 9000 is already in use. Please stop any other services first."
    exit 1
fi

if lsof -i :9001 >/dev/null 2>&1; then
    echo "Error: Port 9001 is already in use. Please stop any other services first."
    exit 1
fi

# Run MinIO container
docker run -d \
  --name erato-minio \
  --rm \
  -e MINIO_ROOT_USER=eratouser \
  -e MINIO_ROOT_PASSWORD=eratopassword \
  -v "$(pwd)/minio_data:/data" \
  -p 9000:9000 \
  -p 9001:9001 \
  minio/minio:RELEASE.2025-03-12T18-04-18Z server /data --console-address ":9001"

# Wait for MinIO to be ready
echo "Waiting for MinIO to start..."
sleep 5

# Check if mc is installed and install if needed
if ! check_mc_installed; then
    echo "MinIO Client (mc) is not installed."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "On macOS, you can install it using Homebrew:"
        echo "    brew install minio/stable/mc"
        echo ""
    else
        echo "You can install it on Linux using:"
        echo "    curl -O https://dl.min.io/client/mc/release/linux-amd64/mc"
        echo "    chmod +x mc"
        echo "    sudo mv mc /usr/local/bin/"
        echo ""
    fi
    
    
    # For automated setup, we need mc, ask to install it
    if [[ "$OSTYPE" == "darwin"* ]]; then
        read -p "Do you want to install mc via Homebrew? (y/n): " install_choice
        if [[ "$install_choice" == "y" || "$install_choice" == "Y" ]]; then
            brew install minio/stable/mc
        fi
    else
        read -p "Do you want to download and install mc? (y/n): " install_choice
        if [[ "$install_choice" == "y" || "$install_choice" == "Y" ]]; then
            curl -O https://dl.min.io/client/mc/release/linux-amd64/mc
            chmod +x mc
            sudo mv mc /usr/local/bin/
        fi
    fi
    
    # Check again if mc is installed
    if ! check_mc_installed; then
        echo "MinIO Client (mc) is still not available. Skipping bucket and credentials setup."
        exit 0
    fi
fi

# Configure MinIO client
echo "Configuring MinIO client..."
mc alias set local http://localhost:9000 eratouser eratopassword

# Create the default bucket if it doesn't exist
echo "Creating default bucket: $DEFAULT_BUCKET"
mc mb local/$DEFAULT_BUCKET --ignore-existing

# Create a policy for the app user
echo "Creating app-specific access key and policy..."
cat > /tmp/app-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket",
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::$DEFAULT_BUCKET",
                "arn:aws:s3:::$DEFAULT_BUCKET/*"
            ]
        }
    ]
}
EOF

# Add policy and create user using updated commands
mc admin policy create local erato-app-policy /tmp/app-policy.json
mc admin user add local $APP_ACCESS_KEY $APP_SECRET_KEY
mc admin policy attach local erato-app-policy --user=$APP_ACCESS_KEY

# Cleanup
rm -f /tmp/app-policy.json

echo "MinIO container is running!"
echo "Connection details:"
echo "  S3 API Endpoint: http://localhost:9000"
echo "  Console: http://localhost:9001"
echo "  Root Access Key: eratouser"
echo "  Root Secret Key: eratopassword"
echo
echo "App credentials:"
echo "  Access Key: $APP_ACCESS_KEY"
echo "  Secret Key: $APP_SECRET_KEY"
echo "  Default bucket: $DEFAULT_BUCKET"
echo
echo "Example MinIO Client (mc) commands:"
echo "  List buckets:               mc ls local"
echo "  List files in bucket:       mc ls local/$DEFAULT_BUCKET"
echo "  Upload a file:              mc cp ./myfile.txt local/$DEFAULT_BUCKET/"
echo "  Download a file:            mc cp local/$DEFAULT_BUCKET/myfile.txt ./myfile.txt"
echo "  View file contents:         mc cat local/$DEFAULT_BUCKET/myfile.txt"
echo "  Remove a file:              mc rm local/$DEFAULT_BUCKET/myfile.txt"
echo "  Make bucket public:         mc anonymous set download local/$DEFAULT_BUCKET"
echo
echo "For more commands:            mc --help" 