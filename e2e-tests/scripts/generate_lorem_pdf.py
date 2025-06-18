#!/usr/bin/env python3
"""
Generate a PDF file with a specified number of words using Lorem Ipsum text.
Creates a properly formatted multi-page document with real text content.

Usage:
    python generate_lorem_pdf.py [filename] [word_count]
    python generate_lorem_pdf.py my_document.pdf 5000
    python generate_lorem_pdf.py --help
"""

import os
import sys
import argparse
import textwrap
import random

# Extended Lorem Ipsum word pool for variety
LOREM_WORDS = [
    "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
    "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore",
    "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis", "nostrud",
    "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex", "ea", "commodo",
    "consequat", "duis", "aute", "irure", "in", "reprehenderit", "voluptate",
    "velit", "esse", "cillum", "fugiat", "nulla", "pariatur", "excepteur", "sint",
    "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui", "officia",
    "deserunt", "mollit", "anim", "id", "est", "laborum", "at", "vero", "eos",
    "accusamus", "accusantium", "doloremque", "laudantium", "totam", "rem",
    "aperiam", "eaque", "ipsa", "quae", "ab", "illo", "inventore", "veritatis",
    "quasi", "architecto", "beatae", "vitae", "dicta", "explicabo", "nemo",
    "ipsam", "quia", "voluptas", "aspernatur", "odit", "aut", "fugit", "magni",
    "dolores", "ratione", "sequi", "nesciunt", "neque", "porro", "quisquam",
    "dolorem", "adipisci", "numquam", "eius", "modi", "tempora", "incidunt",
    "magnam", "quaerat", "voluptatem", "fuga", "harum", "quidem", "rerum",
    "facilis", "expedita", "distinctio", "nam", "libero", "tempore", "cum",
    "soluta", "nobis", "eligendi", "optio", "cumque", "nihil", "impedit",
    "quo", "minus", "maxime", "placeat", "facere", "possimus", "omnis",
    "assumenda", "repellendus", "temporibus", "autem", "officiis", "debitis",
    "saepe", "eveniet", "voluptates", "repudiandae", "recusandae", "itaque",
    "earum", "hic", "tenetur", "sapiente", "delectus", "reiciendis", "maiores",
    "alias", "perferendis", "doloribus", "asperiores", "repellat"
]

def generate_lorem_text(word_count):
    """Generate Lorem Ipsum text with specified word count."""
    words = []
    for i in range(word_count):
        word = random.choice(LOREM_WORDS)
        # Capitalize first word of sentences occasionally
        if i == 0 or (i > 0 and words[-1].endswith('.')):
            word = word.capitalize()
        words.append(word)

        # Add punctuation occasionally
        if (i + 1) % random.randint(8, 20) == 0 and i < word_count - 1:
            if random.random() < 0.7:
                words[-1] += '.'
            elif random.random() < 0.5:
                words[-1] += ','

    # Ensure the text ends with a period
    if not words[-1].endswith('.'):
        words[-1] += '.'

    return ' '.join(words)

def create_pdf_with_text(filename, word_count):
    """Create a PDF with specified number of words using proper formatting."""

    print(f"Generating PDF with {word_count:,} words...")

    # Generate the text content
    text_content = generate_lorem_text(word_count)

    # PDF page dimensions (US Letter: 612 x 792 points)
    page_width = 612
    page_height = 792
    margin = 72  # 1 inch margins
    text_width = page_width - (2 * margin)
    text_height = page_height - (2 * margin)

    # Text formatting parameters
    font_size = 12
    line_height = 14
    chars_per_line = int(text_width / (font_size * 0.6))  # Approximate
    lines_per_page = int(text_height / line_height)

    # Wrap text to fit page width
    wrapped_lines = []
    paragraphs = text_content.split('. ')

    for para in paragraphs:
        if para and not para.endswith('.'):
            para += '.'
        lines = textwrap.fill(para, width=chars_per_line).split('\n')
        wrapped_lines.extend(lines)
        wrapped_lines.append('')  # Add space between paragraphs

    # Remove trailing empty lines
    while wrapped_lines and wrapped_lines[-1] == '':
        wrapped_lines.pop()

    total_pages = max(1, (len(wrapped_lines) + lines_per_page - 1) // lines_per_page)

    print(f"Creating {total_pages} page(s)...")

    with open(filename, "wb") as f:
        # PDF Header
        f.write(b"%PDF-1.4\n")

        obj_positions = {}
        current_obj = 1

        # Object 1: Catalog
        obj_positions[current_obj] = f.tell()
        f.write(f"""{current_obj} 0 obj
<<
/Type /Catalog
/Pages {current_obj + 1} 0 R
>>
endobj
""".encode())
        current_obj += 1

        # Object 2: Pages
        obj_positions[current_obj] = f.tell()
        pages_obj = current_obj
        page_refs = []
        for i in range(total_pages):
            page_refs.append(f"{current_obj + 1 + i} 0 R")

        f.write(f"""{current_obj} 0 obj
<<
/Type /Pages
/Kids [{' '.join(page_refs)}]
/Count {total_pages}
>>
endobj
""".encode())
        current_obj += 1

        # Page objects and content streams
        for page_num in range(total_pages):
            # Page object
            obj_positions[current_obj] = f.tell()
            page_obj = current_obj
            content_obj = current_obj + total_pages

            f.write(f"""{current_obj} 0 obj
<<
/Type /Page
/Parent {pages_obj} 0 R
/MediaBox [0 0 {page_width} {page_height}]
/Resources <<
  /Font <<
    /F1 <<
      /Type /Font
      /Subtype /Type1
      /BaseFont /Helvetica
    >>
  >>
>>
/Contents {content_obj} 0 R
>>
endobj
""".encode())
            current_obj += 1

        # Content stream objects
        for page_num in range(total_pages):
            obj_positions[current_obj] = f.tell()

            # Get lines for this page
            start_line = page_num * lines_per_page
            end_line = min(start_line + lines_per_page, len(wrapped_lines))
            page_lines = wrapped_lines[start_line:end_line]

            # Build content stream
            content_stream = f"BT\n/F1 {font_size} Tf\n{margin} {page_height - margin - font_size} Td\n"

            for line in page_lines:
                # Escape parentheses and backslashes in text
                escaped_line = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                content_stream += f"({escaped_line}) Tj\n0 -{line_height} Td\n"

            # Add page number at bottom
            content_stream += f"0 {margin - page_height + 30} Td\n"
            content_stream += f"(Page {page_num + 1} of {total_pages}) Tj\n"
            content_stream += "ET\n"

            content_bytes = content_stream.encode()

            f.write(f"""{current_obj} 0 obj
<<
/Length {len(content_bytes)}
>>
stream
""".encode())
            f.write(content_bytes)
            f.write(b"endstream\nendobj\n")
            current_obj += 1

        # Write xref table
        xref_pos = f.tell()
        f.write(b"xref\n")
        f.write(f"0 {current_obj}\n".encode())
        f.write(b"0000000000 65535 f \n")

        for i in range(1, current_obj):
            pos_str = f"{obj_positions[i]:010d}"
            f.write(f"{pos_str} 00000 n \n".encode())

        # Write trailer
        f.write(f"""trailer
<<
/Size {current_obj}
/Root 1 0 R
>>
startxref
{xref_pos}
%%EOF
""".encode())

    final_size = os.path.getsize(filename)
    actual_words = len(text_content.split())
    print(f"Generated PDF: {final_size / 1024:.1f}KB ({final_size:,} bytes)")
    print(f"Content: {actual_words:,} words across {total_pages} page(s)")

def main():
    parser = argparse.ArgumentParser(
        description="Generate a PDF file with specified number of Lorem Ipsum words.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                           # Creates lorem_document.pdf (1000 words)
  %(prog)s my_doc.pdf                # Creates my_doc.pdf (1000 words)
  %(prog)s my_doc.pdf 5000           # Creates my_doc.pdf (5000 words)
  %(prog)s --words 2500              # Creates lorem_document.pdf (2500 words)
        """
    )

    parser.add_argument(
        'filename',
        nargs='?',
        default='lorem_document.pdf',
        help='Output PDF filename (default: lorem_document.pdf)'
    )

    parser.add_argument(
        'words',
        nargs='?',
        type=int,
        default=1000,
        help='Number of words to generate (default: 1000)'
    )

    parser.add_argument(
        '--words', '-w',
        dest='words_flag',
        type=int,
        help='Number of words to generate (alternative to positional argument)'
    )

    args = parser.parse_args()

    # Handle the case where --words flag is used
    word_count = args.words_flag if args.words_flag is not None else args.words

    # Validate inputs
    if word_count <= 0:
        print("Error: Word count must be greater than 0", file=sys.stderr)
        sys.exit(1)

    if word_count > 1000000:  # 1M word limit for sanity
        print("Error: Word count limit is 1,000,000 for performance reasons", file=sys.stderr)
        sys.exit(1)

    # Check if file already exists
    if os.path.exists(args.filename):
        response = input(f"File '{args.filename}' already exists. Overwrite? (y/N): ")
        if response.lower() not in ['y', 'yes']:
            print("Aborted.")
            sys.exit(0)

    try:
        create_pdf_with_text(args.filename, word_count)
        print(f"Successfully created: {args.filename}")
    except Exception as e:
        print(f"Error creating PDF: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()