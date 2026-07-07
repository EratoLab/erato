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
#
# With uncommitted locale changes, compares extract output against a
# working-tree snapshot (and restores it) instead of git.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICE_ADDIN_DIR="$(dirname "$SCRIPT_DIR")"

cd "$OFFICE_ADDIN_DIR"

LOCALE_PATTERNS=(
    "src/locales/**/*.po"
)

echo "=== Checking if office-addin i18n catalogs are up-to-date ==="

echo "Checking for uncommitted changes in locale files..."

UNCOMMITTED_CHANGES=false
for pattern in "${LOCALE_PATTERNS[@]}"; do
    if git status --porcelain -- "$pattern" 2>/dev/null | grep -q .; then
        UNCOMMITTED_CHANGES=true
        echo "  Found uncommitted changes matching: $pattern"
    fi
done

if [ "$UNCOMMITTED_CHANGES" = true ]; then
    echo ""
    echo "Uncommitted locale changes detected; comparing against a working-tree snapshot instead."

    SNAPSHOT_DIR="$(mktemp -d)"
    trap 'rm -rf "$SNAPSHOT_DIR"' EXIT
    cp -R src/locales/. "$SNAPSHOT_DIR/"

    echo ""
    echo "Running pnpm run i18n:extract..."
    pnpm run i18n:extract

    echo ""
    echo "Checking for changes after extraction..."
    if diff -r src/locales "$SNAPSHOT_DIR" > /dev/null 2>&1; then
        echo "i18n catalogs are up-to-date"
        exit 0
    fi

    echo "  Changes detected in: src/locales"
    diff -r src/locales "$SNAPSHOT_DIR" || true

    rm -rf src/locales
    mkdir -p src/locales
    cp -R "$SNAPSHOT_DIR/." src/locales/

    echo ""
    echo "i18n catalogs are out of date!"
    echo ""
    echo "Please run 'pnpm run i18n:extract' and commit the changes."
    exit 1
fi

echo "  No uncommitted changes in locale files"
echo ""

echo "Running pnpm run i18n:extract..."
pnpm run i18n:extract

echo ""
echo "Checking for changes after extraction..."

CHANGES_DETECTED=false
for pattern in "${LOCALE_PATTERNS[@]}"; do
    if git diff --quiet -- "$pattern" 2>/dev/null; then
        :
    else
        CHANGES_DETECTED=true
        echo "  Changes detected in: $pattern"
        git diff --stat -- "$pattern" 2>/dev/null || true
    fi
done

echo ""

if [ "$CHANGES_DETECTED" = true ]; then
    echo "i18n catalogs are out of date!"
    echo ""
    echo "Please run 'pnpm run i18n:extract' and commit the changes."
    echo ""
    echo "Changed files:"
    git diff --name-only -- "src/locales/**/*.po" 2>/dev/null || true
    exit 1
else
    echo "i18n catalogs are up-to-date"
    exit 0
fi
