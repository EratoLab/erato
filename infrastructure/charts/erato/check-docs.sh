#!/usr/bin/env bash
#
# Check if README.md is up-to-date with values.yaml
# This script is intended for use in CI/CD pipelines
#
# Usage: ./check-docs.sh
# Exit code 0: README is up-to-date
# Exit code 1: README is out-of-date or missing
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔍 Checking if README.md is up-to-date..."

# Save the current README.md if it exists
if [ -f README.md ]; then
    cp README.md README.md.backup
    BACKUP_EXISTS=true
else
    BACKUP_EXISTS=false
    echo "⚠️  README.md does not exist"
fi

# Generate new README using helm-docs
echo "📝 Generating documentation..."
if command -v helm-docs &> /dev/null; then
    helm-docs . --log-level error
else
    echo ""
    echo "❌ helm-docs is not installed."
    echo "Install it from: https://github.com/norwoodj/helm-docs#installation"
    exit 1
fi

# Check if there are differences
if [ "$BACKUP_EXISTS" = true ]; then
    if ! diff -q README.md README.md.backup > /dev/null 2>&1; then
        echo ""
        echo "❌ README.md is out of date!"
        echo ""
        echo "Differences found:"
        diff -u README.md.backup README.md || true
        echo ""
        echo "To fix this, run:"
        echo "  cd infrastructure/charts/erato && just docs"
        echo ""
        rm README.md.backup
        exit 1
    else
        echo "✅ README.md is up to date!"
        rm README.md.backup
        exit 0
    fi
else
    echo ""
    echo "❌ README.md was missing!"
    echo ""
    echo "Generated README.md - please commit this file."
    echo ""
    exit 1
fi
