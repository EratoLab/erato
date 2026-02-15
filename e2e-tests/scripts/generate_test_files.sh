#!/usr/bin/env bash
set -euxo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
TEST_FILES_DIR="$SCRIPT_DIR/../test-files"

mkdir -p "$TEST_FILES_DIR"

"$SCRIPT_DIR/generate_large_pdf_binary.py" --size 20 "$TEST_FILES_DIR/big-file-20mb.pdf"
"$SCRIPT_DIR/generate_lorem_pdf.py" --words 100000 "$TEST_FILES_DIR/long-file-100k-words.pdf"
"$SCRIPT_DIR/generate_multipage_test_pdf.py" "$TEST_FILES_DIR/multipage-test.pdf" 20
"$SCRIPT_DIR/generate_corrupted_pdf.py" "$TEST_FILES_DIR/corrupted_truncated.pdf" truncated
"$SCRIPT_DIR/generate_corrupted_pdf.py" "$TEST_FILES_DIR/corrupted_malformed.pdf" malformed_stream
"$SCRIPT_DIR/generate_corrupted_pdf.py" "$TEST_FILES_DIR/corrupted_unsupported_encryption.pdf" unsupported_encryption
