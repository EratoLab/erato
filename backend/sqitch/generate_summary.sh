#!/bin/bash

# Exit on error
set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the script directory to ensure sqitch commands work correctly
cd "$SCRIPT_DIR"

# Get the list of migrations from sqitch plan
MIGRATIONS=$(sqitch plan --no-headers --format 'format:%F' | jq -R -s 'split("\n")[:-1]')

# Create the JSON output and format it with jq
cat << EOF | jq '.' > sqitch_summary.json
{
  "migrations": ${MIGRATIONS}
}
EOF

echo "Generated sqitch_summary.json successfully" 