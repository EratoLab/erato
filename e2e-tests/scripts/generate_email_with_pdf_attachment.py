#!/usr/bin/env python3
"""Generate an EML fixture with HTML content and a PDF attachment."""

import argparse
import base64
from pathlib import Path


def wrap_base64(data: bytes, line_length: int = 76) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    return "\n".join(
        encoded[index : index + line_length]
        for index in range(0, len(encoded), line_length)
    )


def create_email_with_pdf_attachment(
    output_filename: str,
    attachment_filename: str,
    attachment_display_name: str,
) -> None:
    attachment_path = Path(attachment_filename)
    attachment_data = attachment_path.read_bytes()
    encoded_attachment = wrap_base64(attachment_data)

    eml_content = f"""From: Erato E2E <e2e@eratolabs.com>
To: Test User <testuser@eratolabs.com>
Subject: E2E HTML email with PDF attachment
Date: Fri, 20 Mar 2026 13:28:03 +0100
Message-ID: <e2e-html-email-with-pdf@eratolabs.com>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="mixed-boundary"

--mixed-boundary
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: 7bit

<!doctype html>
<html>
  <body>
    <h1>E2E Email Fixture</h1>
    <p>This generated email contains <strong>HTML content</strong>.</p>
    <p>The compressed sample report PDF is attached for file processing tests.</p>
  </body>
</html>

--mixed-boundary
Content-Type: application/pdf; name="{attachment_display_name}"
Content-Disposition: attachment; filename="{attachment_display_name}"
Content-Transfer-Encoding: base64

{encoded_attachment}
--mixed-boundary--
"""

    Path(output_filename).write_text(eml_content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate an EML file with HTML content and a PDF attachment."
    )
    parser.add_argument("output_filename", help="Output EML filename")
    parser.add_argument("attachment_filename", help="PDF file to attach")
    parser.add_argument(
        "--attachment-display-name",
        default="sample_compressed.pdf",
        help="Filename to use for the attachment inside the email",
    )
    args = parser.parse_args()

    create_email_with_pdf_attachment(
        args.output_filename,
        args.attachment_filename,
        args.attachment_display_name,
    )


if __name__ == "__main__":
    main()
