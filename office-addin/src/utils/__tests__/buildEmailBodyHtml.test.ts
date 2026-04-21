import { describe, expect, it } from "vitest";

import { buildEmailBodyFile } from "../buildEmailBodyHtml";

describe("buildEmailBodyFile", () => {
  it("renders From/To/CC/Date/Subject headers with HTML escaping", async () => {
    const file = buildEmailBodyFile({
      subject: "Hello & welcome",
      from: { name: "Alice", address: "alice@x" },
      to: [{ address: "bob@x" }],
      cc: [{ name: "Carol", address: "carol@x" }],
      date: new Date("2024-01-02T03:04:05Z"),
      bodyText: "hi",
    });

    expect(file.type).toBe("text/html");
    expect(file.name).toBe("Hello & welcome.html");

    const text = await file.text();
    expect(text).toContain("<strong>From:</strong> Alice &lt;alice@x&gt;");
    expect(text).toContain("<strong>To:</strong> bob@x");
    expect(text).toContain("<strong>CC:</strong> Carol &lt;carol@x&gt;");
    expect(text).toContain("<strong>Subject:</strong> Hello &amp; welcome");
    expect(text).toContain("<strong>Date:</strong>");
  });

  it("wraps plain text body in <pre> when no HTML is provided", async () => {
    const file = buildEmailBodyFile({
      subject: "Plain",
      bodyText: "line one\nline <two>",
    });

    const text = await file.text();
    expect(text).toContain("<pre>line one\nline &lt;two&gt;</pre>");
  });

  it("prefers bodyHtml verbatim when present", async () => {
    const file = buildEmailBodyFile({
      subject: "Rich",
      bodyHtml: "<p>hi</p>",
      bodyText: "ignored",
    });

    const text = await file.text();
    expect(text).toContain("<p>hi</p>");
    expect(text).not.toContain("<pre>");
  });

  it("falls back to empty body when neither text nor html is provided", async () => {
    const file = buildEmailBodyFile({
      subject: "Empty",
    });

    const text = await file.text();
    expect(text).toContain("<strong>Subject:</strong> Empty");
    expect(text).not.toContain("<pre>");
  });

  it("sanitizes illegal filename characters derived from the subject", () => {
    const file = buildEmailBodyFile({
      subject: 'a/b:c<d>e?f|g"h\\i*',
    });
    expect(file.name).toBe("a_b_c_d_e_f_g_h_i_.html");
  });

  it("strips <script> from bodyHtml while preserving surrounding markup", async () => {
    const file = buildEmailBodyFile({
      subject: "xss-script",
      bodyHtml: "<p>before</p><script>alert(1)</script><p>after</p>",
    });
    const text = await file.text();
    expect(text).toContain("<p>before</p>");
    expect(text).toContain("<p>after</p>");
    expect(text).not.toMatch(/<script\b/i);
    expect(text).not.toContain("alert(1)");
  });

  it("removes inline event handlers from bodyHtml but keeps the element", async () => {
    const file = buildEmailBodyFile({
      subject: "xss-event-handler",
      bodyHtml: '<img src="x" onerror="alert(1)">',
    });
    const text = await file.text();
    expect(text).toMatch(/<img\b/i);
    expect(text.toLowerCase()).not.toContain("onerror");
    expect(text).not.toContain("alert(1)");
  });

  it("strips javascript: URLs from anchors but keeps the link text", async () => {
    const file = buildEmailBodyFile({
      subject: "xss-javascript-url",
      bodyHtml: '<a href="javascript:alert(1)">click</a>',
    });
    const text = await file.text();
    expect(text).toContain("click");
    expect(text.toLowerCase()).not.toContain("javascript:");
  });

  it("strips <script> embedded inside <svg>", async () => {
    const file = buildEmailBodyFile({
      subject: "xss-svg",
      bodyHtml: '<svg><script>alert(1)</script><circle r="5"/></svg>',
    });
    const text = await file.text();
    expect(text).not.toMatch(/<script\b/i);
    expect(text).not.toContain("alert(1)");
  });

  it("preserves email-fidelity markup: tables, inline styles, and cid: images", async () => {
    const file = buildEmailBodyFile({
      subject: "fidelity",
      bodyHtml:
        '<table><tr><td style="color:red">cell</td></tr></table>' +
        '<img src="cid:logo123">',
    });
    const text = await file.text();
    expect(text).toMatch(/<table\b/i);
    expect(text).toMatch(/<td\b[^>]*style=/i);
    expect(text).toContain("cid:logo123");
  });
});
