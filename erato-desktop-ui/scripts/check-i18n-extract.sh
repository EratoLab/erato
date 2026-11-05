#!/usr/bin/env bash
#
# Verifies that `pnpm run i18n:extract` doesn't change the catalogs, so the
# committed .po files match the source code.
#
# Usage:
#   ./scripts/check-i18n-extract.sh
#
# Exit codes:
#   0 - Catalogs are up-to-date
#   1 - Catalogs need to be updated (changes detected)
#
# Compares the extract output against a snapshot of the working tree's .po
# files, so it works the same for committed and uncommitted catalogs, and
# always restores the snapshot afterwards.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$APP_DIR"

LOCALES_DIR="src/locales"

echo "=== Checking if erato-desktop-ui i18n catalogs are up-to-date ==="

if [ ! -d "$LOCALES_DIR" ]; then
    echo "No $LOCALES_DIR directory; run 'pnpm run i18n:extract' and commit the catalogs."
    exit 1
fi

SNAPSHOT_DIR="$(mktemp -d)"
restore_snapshot() {
    find "$LOCALES_DIR" -name '*.po' -type f -delete
    (cd "$SNAPSHOT_DIR" && find . -name '*.po' -type f -print0) \
        | while IFS= read -r -d '' file; do
            mkdir -p "$LOCALES_DIR/$(dirname "$file")"
            cp "$SNAPSHOT_DIR/$file" "$LOCALES_DIR/$file"
        done
    rm -rf "$SNAPSHOT_DIR"
}
trap restore_snapshot EXIT

echo "Snapshotting $LOCALES_DIR/**/*.po..."
(cd "$LOCALES_DIR" && find . -name '*.po' -type f -print0) \
    | while IFS= read -r -d '' file; do
        mkdir -p "$SNAPSHOT_DIR/$(dirname "$file")"
        cp "$LOCALES_DIR/$file" "$SNAPSHOT_DIR/$file"
    done

echo ""
echo "Running pnpm run i18n:extract..."
pnpm run i18n:extract

echo ""
echo "Checking for changes after extraction..."
if diff -r --exclude='*.json' --exclude='*.ts' "$SNAPSHOT_DIR" "$LOCALES_DIR" > /dev/null 2>&1; then
    echo "i18n catalogs are up-to-date"
    exit 0
fi

diff -r --exclude='*.json' --exclude='*.ts' "$SNAPSHOT_DIR" "$LOCALES_DIR" || true

echo ""
echo "i18n catalogs are out of date!"
echo ""
echo "Please run 'pnpm run i18n:extract' and commit the changes."
exit 1
