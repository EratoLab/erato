#!/usr/bin/env python3
"""
Generate N PDFs that combine:
1) long, real text content (from generate_lorem_pdf.py), and
2) artificial bloat (binary padding appended to reach a target size).

All files are written to test-files/<subdir>.
"""

import argparse
import os
import sys
from pathlib import Path

from generate_lorem_pdf import create_pdf_with_text


def pad_file_to_target_size(path: Path, target_size_bytes: int) -> None:
    """Append binary padding until the file reaches target size."""
    current_size = path.stat().st_size
    if current_size >= target_size_bytes:
        return

    remaining = target_size_bytes - current_size
    chunk = b"\x00" * (1024 * 1024)

    with path.open("ab") as f:
        while remaining > 0:
            to_write = min(len(chunk), remaining)
            f.write(chunk[:to_write])
            remaining -= to_write


def build_output_path(base_test_files_dir: Path, subdir: str, prefix: str, index: int) -> Path:
    return base_test_files_dir / subdir / f"{prefix}-{index:03d}.pdf"


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a batch of PDFs with long text content and artificial binary bloat "
            "in test-files/<subdir>."
        )
    )
    parser.add_argument(
        "--count",
        "-n",
        type=int,
        default=1,
        help="Number of files to generate (default: 1)",
    )
    parser.add_argument(
        "--subdir",
        "-d",
        default="long-bloated-files",
        help="Subdirectory under test-files/ for outputs (default: long-bloated-files)",
    )
    parser.add_argument(
        "--words",
        "-w",
        type=int,
        default=100000,
        help="Words of real text content per file (default: 100000)",
    )
    parser.add_argument(
        "--size-mb",
        "-s",
        type=int,
        default=20,
        help="Target final file size in MB per file (default: 20)",
    )
    parser.add_argument(
        "--prefix",
        default="long-bloated",
        help="Filename prefix (default: long-bloated)",
    )
    parser.add_argument(
        "--start-index",
        type=int,
        default=1,
        help="Starting index for generated filenames (default: 1)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing files without prompting.",
    )

    args = parser.parse_args()

    if args.count <= 0:
        print("Error: --count must be greater than 0", file=sys.stderr)
        sys.exit(1)

    if args.words <= 0:
        print("Error: --words must be greater than 0", file=sys.stderr)
        sys.exit(1)

    if args.size_mb <= 0:
        print("Error: --size-mb must be greater than 0", file=sys.stderr)
        sys.exit(1)

    if args.start_index <= 0:
        print("Error: --start-index must be greater than 0", file=sys.stderr)
        sys.exit(1)

    script_dir = Path(__file__).resolve().parent
    test_files_dir = script_dir.parent / "test-files"
    output_dir = test_files_dir / args.subdir
    output_dir.mkdir(parents=True, exist_ok=True)

    target_size_bytes = args.size_mb * 1024 * 1024

    print(
        f"Generating {args.count} file(s) in {output_dir} "
        f"with {args.words:,} words and target size {args.size_mb}MB each..."
    )

    generated = []

    for offset in range(args.count):
        index = args.start_index + offset
        output_path = build_output_path(test_files_dir, args.subdir, args.prefix, index)

        if output_path.exists() and not args.force:
            print(
                f"Error: {output_path} already exists. Use --force to overwrite.",
                file=sys.stderr,
            )
            sys.exit(1)

        if output_path.exists() and args.force:
            output_path.unlink()

        print(f"[{offset + 1}/{args.count}] Creating {output_path.name}...")
        create_pdf_with_text(str(output_path), args.words)
        pad_file_to_target_size(output_path, target_size_bytes)

        final_size = output_path.stat().st_size
        generated.append((output_path, final_size))

    print("\nGenerated files:")
    for path, size_bytes in generated:
        print(f"- {path}: {size_bytes / (1024 * 1024):.1f}MB")


if __name__ == "__main__":
    main()
