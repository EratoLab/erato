#!/bin/bash

# Exit on error
set -e

# Default mode is to write files
CHECK_MODE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --check)
      CHECK_MODE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--check]"
      exit 1
      ;;
  esac
done

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the script directory to ensure sqitch commands work correctly
cd "$SCRIPT_DIR"

# Get the list of migrations from sqitch plan
# Get change names and transform them to the original format: deploy/name.sql
MIGRATIONS=$(sqitch plan --no-headers --format 'format:%n' | awk '{print "deploy/" $0 ".sql"}' | jq -R -s 'split("\n")[:-1]')

# Get the latest change hash from the sqitch plan
LATEST_CHANGE=$(sqitch plan --format oneline --reverse --no-headers | head -n 1 | awk '{print $1}')

# Create the expected content for the files
EXPECTED_LATEST_CHANGE="${LATEST_CHANGE}"
EXPECTED_JSON=$(cat << EOF | jq '.'
{
  "migrations": ${MIGRATIONS},
  "latest_change": "${LATEST_CHANGE}"
}
EOF
)

if [ "$CHECK_MODE" = true ]; then
  # Check if files exist
  if [ ! -f "latest_change.txt" ] || [ ! -f "sqitch_summary.json" ]; then
    echo "Error: One or more files don't exist. Run without --check to generate them."
    exit 1
  fi

  # Check if latest_change.txt is up-to-date
  CURRENT_LATEST_CHANGE=$(cat latest_change.txt)
  if [ "$CURRENT_LATEST_CHANGE" != "$EXPECTED_LATEST_CHANGE" ]; then
    echo "Error: latest_change.txt is not up-to-date."
    exit 1
  fi

  # Check if sqitch_summary.json is up-to-date
  CURRENT_JSON=$(cat sqitch_summary.json)
  # Normalize JSON formatting for comparison
  NORMALIZED_CURRENT_JSON=$(echo "$CURRENT_JSON" | jq '.')
  NORMALIZED_EXPECTED_JSON=$(echo "$EXPECTED_JSON" | jq '.')
  
  if [ "$NORMALIZED_CURRENT_JSON" != "$NORMALIZED_EXPECTED_JSON" ]; then
    echo "Error: sqitch_summary.json is not up-to-date."
    exit 1
  fi

  echo "All files are up-to-date."
  exit 0
else
  # Save the latest change hash to a file
  echo "${LATEST_CHANGE}" > latest_change.txt

  # Create the JSON output and save it
  echo "$EXPECTED_JSON" > sqitch_summary.json

  echo "Generated sqitch_summary.json successfully"
  echo "Saved latest change hash to latest_change.txt"
fi 