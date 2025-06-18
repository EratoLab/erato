#!/usr/bin/env python3
"""
Generate a large PDF by creating a minimal valid PDF and padding with binary data.
This is the fastest method and creates exactly the size you want.

Usage:
    python generate_large_pdf_binary.py [filename] [size_mb]
    python generate_large_pdf_binary.py my_test.pdf 250
    python generate_large_pdf_binary.py --help
"""

import os
import sys
import argparse

def create_large_pdf_binary(filename, target_size_mb):
    """Create a large PDF by injecting binary data into a minimal PDF structure."""

    target_size = target_size_mb * 1024 * 1024

    print(f"Generating {target_size_mb}MB PDF with binary padding...")

    with open(filename, "wb") as f:
        # Start building PDF content
        f.write(b"%PDF-1.4\n")

        # Track object positions for xref table
        obj_positions = {}

        # Object 1: Catalog
        obj_positions[1] = f.tell()
        f.write(b"""1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
""")

        # Object 2: Pages
        obj_positions[2] = f.tell()
        f.write(b"""2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
""")

        # Object 3: Page
        obj_positions[3] = f.tell()
        f.write(b"""3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Resources <<
  /Font <<
    /F1 <<
      /Type /Font
      /Subtype /Type1
      /BaseFont /Helvetica
    >>
  >>
>>
/Contents 4 0 R
>>
endobj
""")

        # Object 4: Content stream
        content_stream = b"""BT
/F1 14 Tf
50 750 Td
(Large binary PDF) Tj
0 -20 Td
(Generated for testing purposes) Tj
ET
"""
        obj_positions[4] = f.tell()
        f.write(b"4 0 obj\n<<\n/Length " + str(len(content_stream)).encode() + b"\n>>\nstream\n")
        f.write(content_stream)
        f.write(b"endstream\nendobj\n")

        # Calculate how much padding we need
        current_pos = f.tell()
        footer_size = 200  # Estimate for xref table and trailer
        padding_needed = target_size - current_pos - footer_size

        if padding_needed > 0:
            # Write padding data in chunks
            chunk_size = 1024 * 1024  # 1MB chunks
            padding_written = 0

            while padding_written < padding_needed:
                remaining = min(chunk_size, padding_needed - padding_written)
                # Use null bytes as padding (valid in PDF files)
                chunk = b'\x00' * remaining
                f.write(chunk)
                padding_written += remaining

                if padding_written % (10 * 1024 * 1024) == 0:  # Every 10MB
                    print(f"Written: {(current_pos + padding_written) / (1024*1024):.1f}MB")

        # Write xref table
        xref_pos = f.tell()
        f.write(b"xref\n")
        f.write(b"0 5\n")
        f.write(b"0000000000 65535 f \n")

        for i in range(1, 5):
            pos_str = f"{obj_positions[i]:010d}".encode()
            f.write(pos_str + b" 00000 n \n")

        # Write trailer
        f.write(b"trailer\n<<\n/Size 5\n/Root 1 0 R\n>>\n")
        f.write(b"startxref\n")
        f.write(str(xref_pos).encode())
        f.write(b"\n%%EOF\n")

    final_size = os.path.getsize(filename)
    print(f"Generated PDF: {final_size / (1024*1024):.1f}MB")

def main():
    parser = argparse.ArgumentParser(
        description="Generate a large PDF file with dummy content for testing purposes.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                           # Creates large_test.pdf (100MB)
  %(prog)s my_file.pdf               # Creates my_file.pdf (100MB)
  %(prog)s my_file.pdf 250           # Creates my_file.pdf (250MB)
  %(prog)s --size 50                 # Creates large_test.pdf (50MB)
        """
    )

    parser.add_argument(
        'filename',
        nargs='?',
        default='large_test.pdf',
        help='Output PDF filename (default: large_test.pdf)'
    )

    parser.add_argument(
        'size',
        nargs='?',
        type=int,
        default=100,
        help='Target file size in MB (default: 100)'
    )

    parser.add_argument(
        '--size', '-s',
        dest='size_flag',
        type=int,
        help='Target file size in MB (alternative to positional argument)'
    )

    args = parser.parse_args()

    # Handle the case where --size flag is used
    target_size = args.size_flag if args.size_flag is not None else args.size

    # Validate inputs
    if target_size <= 0:
        print("Error: Size must be greater than 0 MB", file=sys.stderr)
        sys.exit(1)

    if target_size > 10000:  # 10GB limit for safety
        print("Error: Size limit is 10000 MB (10GB) for safety", file=sys.stderr)
        sys.exit(1)

    # Check if file already exists
    if os.path.exists(args.filename):
        response = input(f"File '{args.filename}' already exists. Overwrite? (y/N): ")
        if response.lower() not in ['y', 'yes']:
            print("Aborted.")
            sys.exit(0)

    try:
        create_large_pdf_binary(args.filename, target_size)
        print(f"Successfully created: {args.filename}")
    except Exception as e:
        print(f"Error creating PDF: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()