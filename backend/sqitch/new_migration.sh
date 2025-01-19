#!/bin/bash

# Prompt for the deployment description
echo "Enter deployment description:"
read description

# Convert description to lowercase and replace spaces with underscores
name=$(echo "$description" | tr '[:upper:]' '[:lower:]' | tr ' ' '_')

# Find the latest migration number
latest=$(ls deploy/*.sql 2>/dev/null | grep -o '^deploy/[0-9]\{4\}' | sort -r | head -n1 | grep -o '[0-9]\{4\}' || echo "0000")

# Increment the number
next_num=$(printf "%04d" $((10#$latest + 1)))

# Create the new migration
sqitch add "${next_num}_${name}" -n "$description"

echo "Created new migration: ${next_num}_${name}" 