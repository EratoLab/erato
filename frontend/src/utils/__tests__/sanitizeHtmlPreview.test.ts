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
    [
      "<p>Dear <Title> <Name>, at <Time></p><p>Regards</p>",
      "<p>Dear &lt;Title&gt; &lt;Name&gt;, at &lt;Time&gt;</p><p>Regards</p>",
    ],
    ["<p>Hello<o:p></o:p></p>", "<p>Hello</p>"],
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

    it("leaves the last link alone only while the draft streams", () => {
      const growing = '<a href="https://docs.example.com/guide">https://d';
      expect(sanitizeHtmlPreview(growing, { isStreaming: true })).toBe(
        link("https://docs.example.com/guide", "https://d"),
      );
      expect(sanitizeHtmlPreview(growing)).toContain(
        "https://d (https://docs.example.com/guide)",
      );
    });

    it.each([
      '<p><a href="https://evil.example/">https://bank.example</p>',
      '<a href="https://evil.example/">https://bank.example</a><!--<a>-->',
      '<a href="https://evil.example/">https://bank.example</a><p title="<a>">x</p>',
      '<a href="https://evil.example/">http://192.168.1.10/login</a>',
      '<a href="https://evil.example/">https://intranet/hr</a>',
      '<a href="https://evil.example/">https:\\\\www.bank.example\\login</a>',
      '<a href="https://evil.example/">https:www.bank.example</a>',
      '<a href="https://evil.example/">ftp://bank.example</a>',
      '<a href="https://evil.example/">bank.example:99999</a>',
      '<a href="https://evil.example/">https://www.bank.example[1]</a>',
      `<a href="https://evil.example/">www${String.fromCodePoint(0x200a)}.bank.example</a>`,
      `<a href="https://evil.example/">bank.example${String.fromCodePoint(0x3164)}</a>`,
      '<a href="https://evil.example/">https://www.bank.example@evil.example/</a>',
      '<a href="https://evil.example/"><div>https://www.bank.example</div><div>[safe]</div></a>',
    ])("adds the real target in %s", (draft) => {
      expect(sanitizeHtmlPreview(draft)).toContain(" (https://evil.example/)");
    });

    it.each([
      [
        '<a href="h&#9;ttps://www.bank.example@x.example/">Pay</a>',
        "https://x.example/",
      ],
      [
        '<a href="&#1;https://www.bank.example@x.example/">Pay</a>',
        "https://x.example/",
      ],
      [
        '<a href="mai&#10;lto:anna@example.com?bcc=spy@x.example">Anna</a>',
        "mailto:anna@example.com",
      ],
    ])("reads the address as the browser follows it: %s", (draft, href) => {
      expect(sanitizeHtmlPreview(draft)).toContain(`href="${href}"`);
    });

    it('drops an address that names nobody: <a href="mailto:?to=spy@x.example">', () => {
      expect(
        sanitizeHtmlPreview('<a href="mailto:?to=spy@x.example">Anna</a>'),
      ).toBe("<a>Anna</a>");
    });

    it.each([
      ["Offer.pdf", "https://files.example.com/s/Offer.pdf"],
      ["README.md", "https://code.example.com/tool/README.md"],
      ["Prices_2026.xlsx", "https://files.example.com/p"],
      ["030 123456", "tel:+4930123456"],
      ["+49 (0)30 123456", "tel:+4930123456"],
      ["0800 / 123 456", "tel:0800123456"],
    ])("keeps %j linking to %s", (text, href) => {
      expect(sanitizeHtmlPreview(`<a href="${href}">${text}</a>`)).toBe(
        link(href, text),
      );
    });

    it("adds the target of a website behind a phone number", () => {
      expect(
        sanitizeHtmlPreview('<a href="https://3232235777/">+32 322 357 77</a>'),
      ).toContain("(https://3232235777/)");
    });

    it("adds the real target once, also when cleaned twice", () => {
      const once = sanitizeHtmlPreview(
        '<a href="https://evil.example/">https://bank.example</a>',
      );
      expect(sanitizeHtmlPreview(once)).toBe(once);
    });

    it("shows no hidden character in an added target", () => {
      const override = String.fromCodePoint(0x202e);
      expect(
        sanitizeHtmlPreview(
          '<a href="mailto:%E2%80%AEmoc.knab@evil.example">anna@bank.example</a>',
        ),
      ).not.toContain(override);
    });
  });
});
