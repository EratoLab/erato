import { describe, expect, it } from "vitest";

import { sanitizeHtmlPreview } from "../sanitizeHtmlPreview";

const LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer"';
const link = (href: string, text: string) =>
  `<a href="${href}" ${LINK_ATTRIBUTES}>${text}</a>`;
// A zero-width space, a direction override and a Unicode tag character.
const hidden = String.fromCodePoint(0x200b, 0x202e, 0xe0041);

describe("sanitizeHtmlPreview", () => {
  it("preserves simple email formatting", () => {
    expect(
      sanitizeHtmlPreview("<p>Hello <strong>team</strong><br>Thanks</p>"),
    ).toBe("<p>Hello <strong>team</strong><br>Thanks</p>");
  });

  it("keeps lists, quotes, headings and numbering", () => {
    const html =
      '<h3>Agenda</h3><ul><li>One</li></ul><ol start="4"><li>Four</li></ol><blockquote>Quoted</blockquote>';
    expect(sanitizeHtmlPreview(html)).toBe(html);
  });

  it("keeps a table's grid, caption and spans, not its styling", () => {
    expect(
      sanitizeHtmlPreview(
        '<table border="1" width="100%"><caption>Q3</caption><thead><tr><th align="left" colspan="2">A</th></tr></thead><tbody><tr><td bgcolor="#fff">1</td><td>2</td></tr></tbody></table>',
      ),
    ).toBe(
      '<table border="1"><caption>Q3</caption><thead><tr><th colspan="2">A</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
  });

  it.each([
    [
      "<p>10<sup>6</sup> m<sub>2</sub></p>",
      "<p>10<sup>6</sup> m<sub>2</sub></p>",
    ],
    [
      "<p><del>100</del> <ins>80</ins> EUR</p>",
      "<p><del>100</del> <ins>80</ins> EUR</p>",
    ],
    [
      "<section>one</section><address>two</address>",
      "<div>one</div><div>two</div>",
    ],
    [
      "<dl><dt>Term</dt><dd>Meaning</dd></dl>",
      "<div><div>Term</div><div>Meaning</div></div>",
    ],
  ])("keeps the words of %s apart", (input, expected) => {
    expect(sanitizeHtmlPreview(input)).toBe(expected);
  });

  it.each([
    [
      "<p>Ask Max <max@example.com> or <Name> today</p>",
      "<p>Ask Max &lt;max@example.com&gt; or &lt;Name&gt; today</p>",
    ],
    ["Dear <First Name>,", "Dear &lt;First Name&gt;,"],
    ["<p>a < b and c > d</p>", "<p>a &lt; b and c &gt; d</p>"],
  ])("keeps angle-bracket text that is no tag: %s", (input, expected) => {
    expect(sanitizeHtmlPreview(input)).toBe(expected);
  });

  it("removes blocked tags and event handlers", () => {
    expect(
      sanitizeHtmlPreview(
        '<script>alert(1)</script><p onclick="evil()">Safe</p>',
      ),
    ).toBe("<p>Safe</p>");
  });

  describe("loads nothing remote", () => {
    it.each([
      ['<p>Hi<img src="https://tracker.example/p.gif"></p>', "<p>Hi</p>"],
      [
        '<p>Hi<img srcset="https://tracker.example/p.gif 1x" alt="x"></p>',
        "<p>Hi</p>",
      ],
      [
        '<p style="background:url(https://tracker.example/p.gif)">Hi</p>',
        "<p>Hi</p>",
      ],
      [
        '<table background="https://tracker.example/p.gif"></table>',
        "<table></table>",
      ],
      [
        "<style>@import url(https://tracker.example/s.css)</style><p>Hi</p>",
        "<p>Hi</p>",
      ],
      [
        '<link rel="stylesheet" href="https://tracker.example/s.css"><p>Hi</p>',
        "<p>Hi</p>",
      ],
      [
        '<meta http-equiv="refresh" content="0;url=https://x.example"><p>Hi</p>',
        "<p>Hi</p>",
      ],
      ['<iframe src="https://x.example"></iframe><p>Hi</p>', "<p>Hi</p>"],
      [
        '<object data="https://x.example/a.swf"></object><p>Hi</p>',
        "<p>Hi</p>",
      ],
      ['<embed src="https://x.example/a.swf"><p>Hi</p>', "<p>Hi</p>"],
      [
        '<svg><image href="https://tracker.example/p.gif"/></svg><p>Hi</p>',
        "<p>Hi</p>",
      ],
      [
        '<video poster="https://x.example/p.png"></video><p>Hi</p>',
        "<p>Hi</p>",
      ],
      ['<audio src="https://x.example/a.mp3"></audio><p>Hi</p>', "<p>Hi</p>"],
      ['<base href="https://x.example/"><p>Hi</p>', "<p>Hi</p>"],
      [
        '<form action="https://x.example"><input name="q"></form><p>Hi</p>',
        "<p>Hi</p>",
      ],
    ])("%s", (input, expected) => {
      expect(sanitizeHtmlPreview(input)).toBe(expected);
    });
  });

  describe("keeps no hidden text tricks", () => {
    it.each([
      ['<p style="display:none">secret</p>', "<p>secret</p>"],
      [
        '<span style="color:#ffffff;font-size:0">secret</span>',
        "<span>secret</span>",
      ],
      ['<font color="white" size="1">secret</font>', "secret"],
      ["<p hidden>secret</p>", "<p>secret</p>"],
      ['<p class="hidden sr-only">secret</p>', "<p>secret</p>"],
      ['<p aria-hidden="true" data-x="1" id="a">secret</p>', "<p>secret</p>"],
      [
        "<details><summary>more</summary>secret</details>",
        "<div><div>more</div>secret</div>",
      ],
      ['<p href="https://x.example/?d=secret">Hi</p>', "<p>Hi</p>"],
      ['<p>Hi</p><a href="https://x.example/?d=secret"> </a>', "<p>Hi</p>"],
      [`<p>Hi${hidden}</p>`, "<p>Hi</p>"],
    ])("%s", (input, expected) => {
      expect(sanitizeHtmlPreview(input)).toBe(expected);
    });
  });

  describe("newlines between text outside any block", () => {
    it.each([
      [
        "Hi Anna,\n\nthanks for the <strong>quick</strong> reply.\n\nBest regards\nSam\n",
        "Hi Anna,<br><br>thanks for the <strong>quick</strong> reply.<br><br>Best regards<br>Sam",
      ],
      [
        "Hi Anna,\n\nthe points:\n<ul><li>one</li></ul>\n\nBest regards,<br>\nSam",
        "Hi Anna,<br><br>the points:<ul><li>one</li></ul>Best regards,<br>Sam",
      ],
      ["a\r\nb\rc", "a<br>b<br>c"],
      ["a  \n \n\n  b", "a<br><br>b"],
      ["<b>a</b>\n<i>b</i>", "<b>a</b><br><i>b</i>"],
      ["<p>a</p>\n<p>b</p>\n", "<p>a</p><p>b</p>"],
      ["<p>hard\nwrapped</p>", "<p>hard\nwrapped</p>"],
      ["<b>\n  bold\n</b>", "<b>\n  bold\n</b>"],
    ])("%j", (input, expected) => {
      expect(sanitizeHtmlPreview(input)).toBe(expected);
    });
  });

  it.each([
    ["unclosed tag starts", `${"<".repeat(100_000)}\na`],
    ["spaces before a newline", `a<b>b</b>${" ".repeat(100_000)}\nc`],
    [
      "punctuation in link text",
      `<a href="https://example.com/">a${"(".repeat(100_000)}b</a>`,
    ],
  ])("stays fast on a long run of %s", (_name, input) => {
    const started = Date.now();
    sanitizeHtmlPreview(input);
    expect(Date.now() - started).toBeLessThan(500);
  });

  describe("links", () => {
    it.each([
      ['<a href="javascript:alert(1)">Click</a>', "<a>Click</a>"],
      ['<a href="  JaVaScRiPt:alert(1)">Click</a>', "<a>Click</a>"],
      ['<a href="data:text/html,x">Click</a>', "<a>Click</a>"],
      ['<a href="file:///etc/passwd">Click</a>', "<a>Click</a>"],
      ['<a href="/relative/path">Click</a>', "<a>Click</a>"],
      ['<a href="">Click</a>', "<a>Click</a>"],
      [
        '<a href="https://example.com" ping="https://x.example">Click</a>',
        link("https://example.com", "Click"),
      ],
      [
        '<a href="mailto:team@example.com?bcc=other@x.example&amp;body=hi">Write</a>',
        link("mailto:team@example.com", "Write"),
      ],
      ['<a href="tel:+491234">Call</a>', link("tel:+491234", "Call")],
      [
        '<a href="https://www.bank.example:login@x.example/a">Open</a>',
        link("https://x.example/a", "Open"),
      ],
    ])("%s", (input, expected) => {
      expect(sanitizeHtmlPreview(input)).toBe(expected);
    });

    it.each([
      ["https://bank.example/login", "https://evil.example/login"],
      ["www.bank.example", "https://evil.example/login"],
      ["bank.example", "https://evil.example/login"],
      ["192.168.1.10", "https://evil.example/login"],
      [`${hidden}https://bank.example`, "https://evil.example/login"],
      ["&lt;https://bank.example&gt;", "https://evil.example/login"],
      ["\u201ewww.bank.example\u201c", "https://evil.example/login"],
      ["Visit https://bank.example now", "https://evil.example/login"],
      ["Portal:<br>https://bank.example", "https://evil.example/login"],
      ["Portal:https://bank.example", "https://evil.example/login"],
      ["Click <b>https://bank.example</b>", "https://evil.example/login"],
      ["www.m\u00fcller-bank.example", "https://evil.example/login"],
      ["bank.example:443/login", "https://evil.example/login"],
      ["login.bank.example", "https://bank.example.evil.example/"],
      ["https://bank.example", "tel:+491234"],
      ["+49 30 1234567", "tel:+19005550199"],
      ["help@bank.example", "mailto:thief@evil.example"],
      ["team@bank.example", "mailto:thief@bank.example"],
    ])("adds the real target to %j", (text, href) => {
      const doc = new DOMParser().parseFromString(
        sanitizeHtmlPreview(`<a href="${href}">${text}</a>`),
        "text/html",
      );
      const shown = href.replace(/^(?:mailto|tel):/, "");
      expect(doc.body.textContent?.endsWith(` (${shown})`)).toBe(true);
    });

    it("shows a look-alike target in its encoded form", () => {
      expect(
        sanitizeHtmlPreview(
          '<a href="https://b\u0430nk.example/">bank.example</a>',
        ),
      ).toContain("bank.example (https://xn--bnk-6cd.example/)");
    });

    it.each([
      ["the agenda", "https://example.com/x"],
      ["example.com", "https://example.com/contact"],
      ["www.example.com", "https://example.com/"],
      ["zoom.example/j/123", "https://eu01.zoom.example/j/123"],
      ["Write to team@example.com", "https://example.com/contact"],
      ["team@example.com", "mailto:team@example.com"],
      ["+49 89 123456", "tel:+4989123456"],
      ["Our docs (example.org)", "https://docs.example.com/"],
      ["see section 3.Thanks", "https://example.com/"],
      ["z.B. hier", "https://example.com/"],
    ])("keeps %j linking to %s", (text, href) => {
      expect(sanitizeHtmlPreview(`<a href="${href}">${text}</a>`)).toBe(
        link(href, text),
      );
    });

    it("leaves a link that is still being written alone", () => {
      expect(
        sanitizeHtmlPreview(
          '<a href="https://docs.example.com/guide">https://d',
        ),
      ).toBe(link("https://docs.example.com/guide", "https://d"));
    });
  });
});
