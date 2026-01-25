#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "reportlab==4.2.5",
# ]
# ///
"""
Generate a test PDF file with distinct, identifiable content on each page.

This script creates a PDF document with multiple pages (default: 20), where each page
contains unique content with clear page identifiers. This is useful for testing
page-aware file processors like kreuzberg.

Each page includes:
- Page identifier: PAGE-XXX (unique 3-digit number)
- Topic: Different topic for each page
- Unique markers: MARKER-XXX and unique IDs
- Page-specific bullet points (Point A1, Point A2, etc.)
- Lorem ipsum text with page-specific markers

Usage:
    python generate_multipage_test_pdf.py output.pdf 20
    python generate_multipage_test_pdf.py --help
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY


def generate_page_content(page_num: int) -> str:
    """Generate unique content for a specific page."""
    topics = [
        "Artificial Intelligence and Machine Learning",
        "Cloud Computing Architecture",
        "Database Design Patterns",
        "Web Development Best Practices",
        "Cybersecurity Fundamentals",
        "Software Testing Strategies",
        "Agile Project Management",
        "Data Science and Analytics",
        "Mobile Application Development",
        "DevOps and CI/CD Pipelines",
        "Microservices Architecture",
        "Blockchain Technology",
        "Internet of Things (IoT)",
        "Virtual and Augmented Reality",
        "Quantum Computing Basics",
        "Natural Language Processing",
        "Computer Vision Applications",
        "Distributed Systems Design",
        "API Design and Documentation",
        "Performance Optimization Techniques",
    ]

    topic = topics[page_num % len(topics)]

    content = f"""
    <b>Chapter {page_num}: {topic}</b><br/><br/>

    This is page {page_num} of the test document. Each page contains unique and
    identifiable content to verify that page-aware file processors correctly
    extract and separate content by page boundaries.<br/><br/>

    <b>Page Identifier: PAGE-{page_num:03d}</b><br/><br/>

    On this page, we discuss {topic}. This topic is essential for understanding
    modern software development practices and technologies. The content here is
    designed to be distinct from other pages, making it easy to verify that
    extraction tools properly maintain page boundaries.<br/><br/>

    Key points for page {page_num}:<br/>
    • Point A{page_num}: First important concept<br/>
    • Point B{page_num}: Second critical idea<br/>
    • Point C{page_num}: Third essential principle<br/><br/>

    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
    tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam,
    quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo
    consequat. Page {page_num} contains this unique marker: MARKER-{page_num * 100}.<br/><br/>

    Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore
    eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident,
    sunt in culpa qui officia deserunt mollit anim id est laborum. Remember, this
    is page {page_num}, distinguished by its unique identifier PAGE-{page_num:03d}.<br/><br/>

    <b>Summary for Page {page_num}:</b><br/>
    This page covered fundamental aspects of {topic}. When extracting this
    document, tools should clearly indicate that this content belongs to page
    {page_num}, separate from pages {page_num - 1} and {page_num + 1}.<br/><br/>

    <i>End of Page {page_num} - Unique ID: {page_num * 999}</i>
    """

    return content


def create_pdf(output_path: Path, num_pages: int):
    """Create a PDF with the specified number of pages."""
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=18,
    )

    # Container for the 'Flowable' objects
    elements = []

    # Define styles
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='Justify',
        parent=styles['BodyText'],
        alignment=TA_JUSTIFY,
        fontSize=11,
        leading=14,
    ))

    title_style = ParagraphStyle(
        name='CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor='darkblue',
        alignment=TA_CENTER,
        spaceAfter=30,
    )

    # Add title page
    title = Paragraph(
        "Test Document for Page-Aware File Processing",
        title_style
    )
    elements.append(title)
    elements.append(Spacer(1, 0.5 * inch))

    subtitle = Paragraph(
        f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}<br/>"
        f"Total Pages: {num_pages}<br/><br/>"
        "This document contains unique content on each page to test<br/>"
        "page-aware extraction capabilities of file processors.",
        styles['Normal']
    )
    subtitle.alignment = TA_CENTER
    elements.append(subtitle)
    elements.append(PageBreak())

    # Add content pages
    for page_num in range(1, num_pages + 1):
        content = generate_page_content(page_num)
        para = Paragraph(content, styles['Justify'])
        elements.append(para)

        # Add page break except for the last page
        if page_num < num_pages:
            elements.append(PageBreak())

    # Build PDF
    doc.build(elements)
    print(f"✓ Generated PDF with {num_pages} pages: {output_path}")
    print(f"  Each page contains unique identifiers (PAGE-XXX) for testing")
    print(f"  File size: {output_path.stat().st_size:,} bytes")


def main():
    parser = argparse.ArgumentParser(
        description="Generate a test PDF with distinct content on each page",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python generate_multipage_test_pdf.py test.pdf 20
  python generate_multipage_test_pdf.py output.pdf 50

The generated PDF will have unique identifiers on each page:
  - PAGE-001, PAGE-002, etc.
  - MARKER-100, MARKER-200, etc.
  - Unique content topics per page
        """
    )
    parser.add_argument(
        "output",
        type=str,
        help="Output PDF file path"
    )
    parser.add_argument(
        "pages",
        type=int,
        nargs='?',
        default=20,
        help="Number of pages to generate (default: 20)"
    )

    args = parser.parse_args()

    if args.pages < 1:
        print("Error: Number of pages must be at least 1", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output)

    # Create parent directory if it doesn't exist
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        create_pdf(output_path, args.pages)
    except Exception as e:
        print(f"Error generating PDF: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
