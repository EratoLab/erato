import { describe, expect, it } from "vitest";

import { sanitizeHtmlPreview } from "../sanitizeHtmlPreview";

describe("sanitizeHtmlPreview", () => {
  it("preserves simple email formatting", () => {
    expect(
      sanitizeHtmlPreview("<p>Hello <strong>team</strong><br>Thanks</p>"),
    ).toBe("<p>Hello <strong>team</strong><br>Thanks</p>");
  });

  it("removes blocked tags and event handlers", () => {
    expect(
      sanitizeHtmlPreview(
        '<script>alert(1)</script><p onclick="evil()">Safe</p>',
      ),
    ).toBe("<p>Safe</p>");
  });

  it("removes unsafe href values", () => {
    expect(
      sanitizeHtmlPreview('<a href="javascript:alert(1)">Click</a>'),
    ).toBe("<a>Click</a>");
  });
});
