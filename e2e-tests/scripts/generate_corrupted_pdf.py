#!/usr/bin/env python3
"""
Generate a corrupted PDF file for testing error handling.
Creates various types of corrupted PDF files to test parsing error scenarios.

Usage:
    python generate_corrupted_pdf.py [filename] [corruption_type]
    python generate_corrupted_pdf.py test.pdf truncated
    python generate_corrupted_pdf.py --help
"""

import os
import sys
import argparse


CORRUPTION_TYPES = {
    "truncated": "PDF with truncated content (missing EOF)",
    "invalid_header": "PDF with invalid header",
    "missing_xref": "PDF with missing cross-reference table",
    "corrupted_object": "PDF with corrupted object structure",
    "unsupported_encryption": "PDF with unsupported encryption (key length)",
    "malformed_stream": "PDF with malformed stream data",
}


def generate_truncated_pdf(filename):
    """Generate a PDF that's truncated mid-stream."""
    print(f"Generating truncated PDF...")

    with open(filename, "wb") as f:
        f.write(b"%PDF-1.4\n")
        f.write(b"1 0 obj\n")
        f.write(b"<<\n")
        f.write(b"/Type /Catalog\n")
        f.write(b"/Pages 2 0 R\n")
        f.write(b">>\n")
        f.write(b"endobj\n")
        f.write(b"2 0 obj\n")
        f.write(b"<<\n")
        f.write(b"/Type /Pages\n")
        f.write(b"/Kids [3 0 R]\n")
        # Truncate here - no endobj, no xref, no EOF


def generate_invalid_header_pdf(filename):
    """Generate a PDF with an invalid header."""
    print(f"Generating PDF with invalid header...")

    with open(filename, "wb") as f:
        # Invalid PDF version
        f.write(b"%PDF-99.99\n")
        f.write(b"1 0 obj\n")
        f.write(b"<<\n")
        f.write(b"/Type /Catalog\n")
        f.write(b"/Pages 2 0 R\n")
        f.write(b">>\n")
        f.write(b"endobj\n")
        f.write(b"%%EOF\n")


def generate_missing_xref_pdf(filename):
    """Generate a PDF with missing cross-reference table."""
    print(f"Generating PDF with missing cross-reference table...")

    with open(filename, "wb") as f:
        f.write(b"%PDF-1.4\n")
        f.write(b"1 0 obj\n")
        f.write(b"<<\n")
        f.write(b"/Type /Catalog\n")
        f.write(b"/Pages 2 0 R\n")
        f.write(b">>\n")
        f.write(b"endobj\n")
        f.write(b"2 0 obj\n")
        f.write(b"<<\n")
        f.write(b"/Type /Pages\n")
        f.write(b"/Kids [3 0 R]\n")
        f.write(b"/Count 1\n")
        f.write(b">>\n")
        f.write(b"endobj\n")
        # Missing xref table
        f.write(b"trailer\n")
        f.write(b"<<\n")
        f.write(b"/Size 3\n")
        f.write(b"/Root 1 0 R\n")
        f.write(b">>\n")
        f.write(b"startxref\n")
        f.write(b"0\n")
        f.write(b"%%EOF\n")


def generate_corrupted_object_pdf(filename):
    """Generate a PDF with corrupted object structure."""
    print(f"Generating PDF with corrupted object structure...")

    with open(filename, "wb") as f:
        f.write(b"%PDF-1.4\n")
        f.write(b"1 0 obj\n")
        f.write(b"<<\n")
        f.write(b"/Type /Catalog\n")
        f.write(b"/Pages 2 0 R\n")
        # Missing closing >> and endobj
        f.write(b"2 0 obj\n")
        f.write(b"<<\n")
        f.write(b"/Type /Pages\n")
        f.write(b"/Kids CORRUPTED_DATA_HERE\n")
        f.write(b">>\n")
        f.write(b"endobj\n")
        f.write(b"%%EOF\n")


def generate_unsupported_encryption_pdf(filename):
    """
    Generate a PDF with unsupported encryption settings.
    This mimics the actual error seen in the logs: "unsupported key length"
    """
    print(f"Generating PDF with unsupported encryption...")

    with open(filename, "wb") as f:
        # PDF Header
        f.write(b"%PDF-1.7\n")

        # Object 1: Catalog
        f.write(b"""1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
""")

        # Object 2: Pages
        f.write(b"""2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
""")

        # Object 3: Page
        f.write(b"""3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
  /Font <<
    /F1 <<
      /Type /Font
      /Subtype /Type1
      /BaseFont /Helvetica
    >>
  >>
>>
>>
endobj
""")

        # Object 4: Content Stream
        content = b"BT\n/F1 12 Tf\n100 700 Td\n(Encrypted Document) Tj\nET\n"
        f.write(f"""4 0 obj
<<
/Length {len(content)}
>>
stream
""".encode())
        f.write(content)
        f.write(b"""endstream
endobj
""")

        # Object 5: Encryption Dictionary with unsupported settings
        # Using an invalid/unsupported key length to trigger parsing errors
        f.write(b"""5 0 obj
<<
/Filter /Standard
/V 5
/R 6
/Length 1024
/P -1
/O <0000000000000000000000000000000000000000000000000000000000000000>
/U <0000000000000000000000000000000000000000000000000000000000000000>
/OE <0000000000000000000000000000000000000000000000000000000000000000>
/UE <0000000000000000000000000000000000000000000000000000000000000000>
/Perms <0000000000000000000000000000000000>
/StrF /StdCF
/StmF /StdCF
/CF <<
  /StdCF <<
    /CFM /AESV3
    /AuthEvent /DocOpen
    /Length 32
  >>
>>
>>
endobj
""")

        # Write xref table
        xref_pos = f.tell()
        f.write(b"xref\n")
        f.write(b"0 6\n")
        f.write(b"0000000000 65535 f \n")
        f.write(b"0000000009 00000 n \n")
        f.write(b"0000000068 00000 n \n")
        f.write(b"0000000135 00000 n \n")
        f.write(b"0000000369 00000 n \n")
        f.write(b"0000000478 00000 n \n")

        # Write trailer with encryption reference
        f.write(f"""trailer
<<
/Size 6
/Root 1 0 R
/Encrypt 5 0 R
>>
startxref
{xref_pos}
%%EOF
""".encode())


def generate_malformed_stream_pdf(filename):
    """Generate a PDF with malformed stream data."""
    print(f"Generating PDF with malformed stream...")

    with open(filename, "wb") as f:
        f.write(b"%PDF-1.4\n")

        # Object 1: Catalog
        f.write(b"""1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
""")

        # Object 2: Pages
        f.write(b"""2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
""")

        # Object 3: Page
        f.write(b"""3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
""")

        # Object 4: Malformed stream (wrong length, corrupted data)
        f.write(b"""4 0 obj
<<
/Length 9999
>>
stream
CORRUPTED_BINARY_DATA_\x00\xff\xfe\xfd
endstream
endobj
""")

        # Minimal xref and trailer
        f.write(b"%%EOF\n")


def main():
    parser = argparse.ArgumentParser(
        description="Generate corrupted PDF files for testing error handling.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Corruption Types:
{chr(10).join(f"  {k:20s} - {v}" for k, v in CORRUPTION_TYPES.items())}

Examples:
  %(prog)s                                    # Creates corrupted.pdf (truncated)
  %(prog)s test.pdf                           # Creates test.pdf (truncated)
  %(prog)s test.pdf invalid_header            # Creates test.pdf with invalid header
  %(prog)s test.pdf unsupported_encryption    # Creates test.pdf with encryption error
        """
    )

    parser.add_argument(
        'filename',
        nargs='?',
        default='corrupted.pdf',
        help='Output PDF filename (default: corrupted.pdf)'
    )

    parser.add_argument(
        'corruption_type',
        nargs='?',
        default='truncated',
        choices=list(CORRUPTION_TYPES.keys()),
        help='Type of corruption to generate (default: truncated)'
    )

    args = parser.parse_args()

    # Check if file already exists
    if os.path.exists(args.filename):
        response = input(f"File '{args.filename}' already exists. Overwrite? (y/N): ")
        if response.lower() not in ['y', 'yes']:
            print("Aborted.")
            sys.exit(0)

    try:
        # Generate the appropriate corrupted PDF
        if args.corruption_type == 'truncated':
            generate_truncated_pdf(args.filename)
        elif args.corruption_type == 'invalid_header':
            generate_invalid_header_pdf(args.filename)
        elif args.corruption_type == 'missing_xref':
            generate_missing_xref_pdf(args.filename)
        elif args.corruption_type == 'corrupted_object':
            generate_corrupted_object_pdf(args.filename)
        elif args.corruption_type == 'unsupported_encryption':
            generate_unsupported_encryption_pdf(args.filename)
        elif args.corruption_type == 'malformed_stream':
            generate_malformed_stream_pdf(args.filename)

        file_size = os.path.getsize(args.filename)
        print(f"Generated corrupted PDF: {file_size:,} bytes")
        print(f"Corruption type: {args.corruption_type}")
        print(f"Successfully created: {args.filename}")
        print(f"\nThis file should trigger a parsing error when processed.")

    except Exception as e:
        print(f"Error creating corrupted PDF: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
