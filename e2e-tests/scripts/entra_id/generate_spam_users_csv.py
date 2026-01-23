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


NAME_POOL = [
    "Alex", "Blake", "Casey", "Drew", "Evan",
    "Finn", "Gray", "Harper", "Jordan", "Kai",
    "Lane", "Morgan", "Nolan", "Parker", "Quinn",
    "Reese", "Riley", "Rowan", "Sawyer", "Taylor",
]


def _read_last_non_empty_line(lines):
    for line in reversed(lines):
        if line.strip():
            return line
    return None


def _parse_template(template_path):
    lines = template_path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 3:
        raise ValueError("Template must have at least 3 lines")

    version_line = lines[0]
    header_line = lines[1]
    template_line = _read_last_non_empty_line(lines[2:])
    if not template_line:
        raise ValueError("Template file has no data rows")

    header_cols = next(csv.reader([header_line], skipinitialspace=True))
    template_cols = next(csv.reader([template_line], skipinitialspace=True))

    if len(template_cols) > len(header_cols):
        raise ValueError("Template row has more columns than header")

    template_cols += [""] * (len(header_cols) - len(template_cols))
    return version_line, header_cols, template_cols


def _derive_upn_parts(upn, count, start, domain_override=None):
    if "@" not in upn:
        raise ValueError("UPN column must contain '@'")

    local, domain = upn.split("@", 1)
    if domain_override:
        domain = domain_override

    match = re.search(r"(\d+)", local)
    if match:
        width = len(match.group(1))
        prefix = local[:match.start()]
        suffix = local[match.end():]
    else:
        width = max(4, len(str(start + count - 1)))
        prefix = local
        suffix = ""

    return prefix, suffix, domain, width


def _format_upn(prefix, suffix, domain, number, width):
    return f"{prefix}{number:0{width}d}{suffix}@{domain}"


def main():
    parser = argparse.ArgumentParser(
        description="Generate Entra ID user-create CSV from a template.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ./generate_spam_users_csv.py --input UserCreateTemplate.csv
  ./generate_spam_users_csv.py --count 6000 --domain maxgoisser.onmicrosoft.com
  ./generate_spam_users_csv.py --input /tmp/UserCreateTemplate.csv --output /tmp/UserCreateTemplate_spam.csv
        """,
    )

    parser.add_argument(
        "--input",
        dest="input_path",
        default="UserCreateTemplate.csv",
        help="Path to the create template CSV",
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
        help="UPN domain override (default: from template)",
    )

    args = parser.parse_args()

    if args.count <= 0:
        print("Error: --count must be greater than 0", file=sys.stderr)
        sys.exit(1)
    if args.start <= 0:
        print("Error: --start must be greater than 0", file=sys.stderr)
        sys.exit(1)

    template_path = Path(args.input_path)
    if not template_path.exists():
        print(f"Error: template not found: {template_path}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output_path) if args.output_path else template_path.with_name(
        f"{template_path.stem}_spam{template_path.suffix}"
    )

    try:
        version_line, header_cols, template_cols = _parse_template(template_path)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    if len(template_cols) < 2:
        print("Error: template row must include display name and UPN columns", file=sys.stderr)
        sys.exit(1)

    prefix, suffix, domain, width = _derive_upn_parts(
        template_cols[1], args.count, args.start, args.domain
    )

    with output_path.open("w", newline="", encoding="utf-8") as f:
        f.write(f"{version_line}\n")
        writer = csv.writer(f)
        writer.writerow(header_cols)

        for i in range(args.start, args.start + args.count):
            number = i
            name = NAME_POOL[(i - args.start) % len(NAME_POOL)]
            formatted = f"{number:0{width}d}"

            new_cols = template_cols.copy()
            new_cols[0] = f"Spam {name} {formatted}"
            new_cols[1] = _format_upn(prefix, suffix, domain, number, width)

            writer.writerow(new_cols)

    print(f"Wrote {args.count} rows to {output_path}")


if __name__ == "__main__":
    main()
