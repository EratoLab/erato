#!/bin/bash

# Exit on error
set -e

# Function to print usage
usage() {
    echo "Usage: $0 --db-uri <database_uri>"
    echo "Example: $0 --db-uri 'db:pg://user:pass@host:5432/dbname'"
    exit 1
}

# Function to test database name extraction
test_db_extraction() {
    local uri="$1"
    local expected="$2"
    local result=$(echo "$uri" | sed -E 's/.*\/([^?]+).*/\1/')
    if [ "$result" = "$expected" ]; then
        echo "✓ Correctly extracted '$expected' from '$uri'"
    else
        echo "✗ Failed to extract from '$uri'. Expected '$expected' but got '$result'"
        exit 1
    fi
}

# Run tests if --test flag is provided
if [ "$1" = "--test" ]; then
    echo "Running database name extraction tests..."
    test_db_extraction "db:pg://user:pass@host:5432/mydb" "mydb"
    test_db_extraction "postgresql://user:pass@host:5432/mydb" "mydb"
    test_db_extraction "db:pg://user:pass@host:5432/mydb?sslmode=disable" "mydb"
    echo "All tests passed!"
    exit 0
fi

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --db-uri) DB_URI="$2"; shift ;;
        *) usage ;;
    esac
    shift
done

# Check if DB_URI is provided
if [ -z "$DB_URI" ]; then
    usage
fi

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the script directory to ensure sqitch commands work correctly
cd "$SCRIPT_DIR"

# Extract database name from URI
# This handles both formats:
# - db:pg://user:pass@host:5432/dbname
# - postgresql://user:pass@host:5432/dbname
# - db:pg://user:pass@host:5432/dbname?sslmode=disable
DB_NAME=$(echo "$DB_URI" | sed -E 's/.*\/([^?]+).*/\1/')
# Schema public
DB_NAME="public"

echo "Extracted database name (will be used as registry): $DB_NAME"

# Deploy using the distributed target, overriding URI and registry
sqitch deploy "distributed" \
    --registry "$DB_NAME" \
    --target "$DB_URI"

echo "Deployment completed successfully" 