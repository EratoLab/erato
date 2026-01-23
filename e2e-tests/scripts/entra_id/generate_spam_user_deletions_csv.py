#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = []
# ///

import argparse
import csv
import re
import sys
from pathlib import Path


def _read_last_non_empty_line(lines):
    for line in reversed(lines):
        if line.strip():
            return line
    return None


def _parse_create_template(template_path):
    lines = template_path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 3:
        raise ValueError("Create template must have at least 3 lines")

    template_line = _read_last_non_empty_line(lines[2:])
    if not template_line:
        raise ValueError("Create template file has no data rows")

    template_cols = next(csv.reader([template_line], skipinitialspace=True))
    if len(template_cols) < 2:
        raise ValueError("Create template row must include a UPN column")

    upn = template_cols[1]
    if "@" not in upn:
        raise ValueError("UPN column must contain '@'")

    local, domain = upn.split("@", 1)
    match = re.search(r"(\d+)", local)
    if match:
        width = len(match.group(1))
        prefix = local[:match.start()]
        suffix = local[match.end():]
    else:
        width = 4
        prefix = local
        suffix = ""

    return prefix, suffix, domain, width


def _parse_delete_template(template_path):
    lines = template_path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2:
        raise ValueError("Delete template must have at least 2 lines")

    version_line = lines[0]
    header_line = lines[1]
    header_cols = next(csv.reader([header_line], skipinitialspace=True))
    return version_line, header_cols


def main():
    parser = argparse.ArgumentParser(
        description="Generate Entra ID user-delete CSV from a template.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ./generate_spam_user_deletions_csv.py --input UserDelete.csv --domain maxgoisser.onmicrosoft.com
  ./generate_spam_user_deletions_csv.py --count 6000 --domain maxgoisser.onmicrosoft.com
  ./generate_spam_user_deletions_csv.py --create-template UserCreateTemplate.csv --input UserDelete.csv
        """,
    )

    parser.add_argument(
        "--input",
        dest="input_path",
        default="UserDelete.csv",
        help="Path to the delete template CSV",
    )
    parser.add_argument(
        "--output",
        dest="output_path",
        default=None,
        help="Output CSV path (default: <input>_spam.csv)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=6000,
        help="Number of users to generate (default: 6000)",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=1,
        help="Starting counter value (default: 1)",
    )
    parser.add_argument(
        "--domain",
        default=None,
        help="UPN domain override (default: from create template if provided)",
    )
    parser.add_argument(
        "--create-template",
        dest="create_template",
        default=None,
        help="Optional create template to derive UPN prefix/domain/width",
    )
    parser.add_argument(
        "--prefix",
        default=None,
        help="UPN local-part prefix override (default: derived or 'spamuser')",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=None,
        help="Digit width for counter (default: derived or 4)",
    )

    args = parser.parse_args()

    if args.count <= 0:
        print("Error: --count must be greater than 0", file=sys.stderr)
        sys.exit(1)
    if args.start <= 0:
        print("Error: --start must be greater than 0", file=sys.stderr)
        sys.exit(1)

    input_path = Path(args.input_path)
    if not input_path.exists():
        print(f"Error: template not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output_path) if args.output_path else input_path.with_name(
        f"{input_path.stem}_spam{input_path.suffix}"
    )

    try:
        version_line, header_cols = _parse_delete_template(input_path)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    derived_prefix = None
    derived_suffix = None
    derived_domain = None
    derived_width = None
    if args.create_template:
        try:
            derived_prefix, derived_suffix, derived_domain, derived_width = _parse_create_template(
                Path(args.create_template)
            )
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)

    prefix = args.prefix or derived_prefix or "spamuser"
    suffix = derived_suffix or ""
    domain = args.domain or derived_domain
    width = args.width or derived_width or max(4, len(str(args.start + args.count - 1)))

    if not domain:
        print("Error: --domain is required when no create template is provided", file=sys.stderr)
        sys.exit(1)

    with output_path.open("w", newline="", encoding="utf-8") as f:
        f.write(f"{version_line}\n")
        writer = csv.writer(f)
        writer.writerow(header_cols)

        for i in range(args.start, args.start + args.count):
            upn = f"{prefix}{i:0{width}d}{suffix}@{domain}"
            writer.writerow([upn])

    print(f"Wrote {args.count} rows to {output_path}")


if __name__ == "__main__":
    main()
