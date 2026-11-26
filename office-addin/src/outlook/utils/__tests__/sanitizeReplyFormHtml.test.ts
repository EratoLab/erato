import { describe, expect, it } from "vitest";

import { sanitizeReplyFormHtml } from "../sanitizeReplyFormHtml";

describe("sanitizeReplyFormHtml", () => {
  it("keeps basic text structure and safe links", () => {
    expect(
      sanitizeReplyFormHtml(
        '<p>Hi <strong>Bob</strong>,<br>see <a href="https://example.com">this</a></p>',
      ),
    ).toBe(
      '<p>Hi <strong>Bob</strong>,<br>see <a href="https://example.com">this</a></p>',
    );
    expect(sanitizeReplyFormHtml('<a href="mailto:a@b.c">mail</a>')).toBe(
      '<a href="mailto:a@b.c">mail</a>',
    );
  });

  it("strips scripts, event handlers, and javascript: URLs", () => {
    expect(sanitizeReplyFormHtml("<p>hi<script>x()</script></p>")).toBe(
      "<p>hi</p>",
    );
    expect(sanitizeReplyFormHtml('<p onclick="x()">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeReplyFormHtml('<a href="javascript:x()">hi</a>')).toBe(
      "<a>hi</a>",
    );
  });

  it("strips style tags/attributes and images, keeps tables without attributes", () => {
    expect(sanitizeReplyFormHtml('<p style="color:red">hi</p>')).toBe(
      "<p>hi</p>",
    );
    expect(
      sanitizeReplyFormHtml("<style>p{display:none}</style><p>hi</p>"),
    ).toBe("<p>hi</p>");
    expect(sanitizeReplyFormHtml('<p><img src="https://x/y.png">hi</p>')).toBe(
      "<p>hi</p>",
    );
    expect(
      sanitizeReplyFormHtml('<table width="1"><tr><td>cell</td></tr></table>'),
    ).toBe("<table><tbody><tr><td>cell</td></tr></tbody></table>");
    expect(sanitizeReplyFormHtml('<a href="data:text/html,x">hi</a>')).toBe(
      "<a>hi</a>",
    );
  });

  it("removes hidden text tricks and shows a spoofed link's real target", () => {
    expect(
      sanitizeReplyFormHtml(
        '<font color="white">secret</font><p hidden class="hidden">x</p><a href="https://evil.example">https://bank.example</a>',
      ),
    ).toBe(
      'secret<p>x</p><a href="https://evil.example">https://evil.example</a>',
    );
  });
});
