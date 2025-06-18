#!/usr/bin/env bash
set -euxo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
"$SCRIPT_DIR/generate_large_pdf_binary.py" --size 100 "$SCRIPT_DIR/../test-files/big-file-100mb.pdf"
"$SCRIPT_DIR/generate_lorem_pdf.py" --words 100000 "$SCRIPT_DIR/../test-files/long-file-100k-words.pdf"
