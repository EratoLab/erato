#!/usr/bin/env bash
#
# Verifies that `pnpm run i18n:extract` doesn't produce any changes.
# This ensures that translation catalogs are up-to-date with the source code.
#
# Usage:
#   ./scripts/check-i18n-extract.sh
#
# Exit codes:
#   0 - Catalogs are up-to-date
#   1 - Catalogs need to be updated (changes detected)
#   2 - Cannot run check due to uncommitted changes in locale files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$FRONTEND_DIR"

# Define locale file patterns to check
LOCALE_PATTERNS=(
    "src/locales/**/*.po"
    "public/custom-theme/**/locales/**/*.po"
)

echo "=== Checking if i18n catalogs are up-to-date ==="

# Protection: Check if there are uncommitted changes to locale files
# This prevents accidentally overwriting local changes
echo "Checking for uncommitted changes in locale files..."

UNCOMMITTED_CHANGES=false
for pattern in "${LOCALE_PATTERNS[@]}"; do
    # Use git status to check for changes (both staged and unstaged)
    if git status --porcelain -- "$pattern" 2>/dev/null | grep -q .; then
        UNCOMMITTED_CHANGES=true
        echo "  ⚠️  Found uncommitted changes matching: $pattern"
    fi
done

if [ "$UNCOMMITTED_CHANGES" = true ]; then
    echo ""
    echo "❌ Cannot run i18n:extract check: uncommitted changes detected in locale files."
    echo "   Please commit or stash your changes first."
    exit 2
fi

echo "  ✓ No uncommitted changes in locale files"
echo ""

# Run the extraction
echo "Running pnpm run i18n:extract..."
pnpm run i18n:extract

# Check if any locale files were modified
echo ""
echo "Checking for changes after extraction..."

CHANGES_DETECTED=false
for pattern in "${LOCALE_PATTERNS[@]}"; do
    if git diff --quiet -- "$pattern" 2>/dev/null; then
        : # No changes for this pattern
    else
        CHANGES_DETECTED=true
        echo "  ⚠️  Changes detected in: $pattern"
        # Show a summary of what changed
        git diff --stat -- "$pattern" 2>/dev/null || true
    fi
done

echo ""

if [ "$CHANGES_DETECTED" = true ]; then
    echo "❌ i18n catalogs are out of date!"
    echo ""
    echo "Please run 'pnpm run i18n:extract' and commit the changes."
    echo ""
    echo "Changed files:"
    git diff --name-only -- "src/locales/**/*.po" "public/custom-theme/**/locales/**/*.po" 2>/dev/null || true
    exit 1
else
    echo "✓ i18n catalogs are up-to-date"
    exit 0
fi

