import { describe, expect, it } from "vitest";

import { sanitizeHtmlPreview } from "../sanitizeHtmlPreview";

describe("sanitizeHtmlPreview", () => {
  it("preserves simple email formatting", () => {
    expect(
      sanitizeHtmlPreview("<p>Hello <strong>team</strong><br>Thanks</p>"),
    ).toBe("<p>Hello <strong>team</strong><br>Thanks</p>");
  });

  it("keeps lists, quotes, headings and plain links", () => {
    const html =
      '<h3>Agenda</h3><ul><li>One</li></ul><ol><li>Two</li></ol><blockquote>Quoted</blockquote><p><a href="https://example.com/a">the page</a></p>';
    expect(sanitizeHtmlPreview(html)).toBe(html);
  });

  it("keeps tables without their attributes", () => {
    expect(
      sanitizeHtmlPreview(
        '<table border="1" width="100%"><thead><tr><th align="left">A</th></tr></thead><tbody><tr><td bgcolor="#fff">1</td></tr></tbody></table>',
      ),
    ).toBe(
      "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
    );
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
      ["<details><summary>more</summary>secret</details>", "moresecret"],
    ])("%s", (input, expected) => {
      expect(sanitizeHtmlPreview(input)).toBe(expected);
    });
  });

  describe("newlines in a draft without block tags", () => {
    it.each([
      [
        "Hi Anna,\n\nthanks for the <strong>quick</strong> reply.\n\nBest regards\nSam\n",
        "Hi Anna,<br><br>thanks for the <strong>quick</strong> reply.<br><br>Best regards<br>Sam",
      ],
      ["a\r\nb", "a<br>b"],
      [
        '<a\nhref="https://example.com/">x</a>\ny',
        '<a href="https://example.com/">x</a><br>y',
      ],
      ["<p>a</p>\n<p>b</p>", "<p>a</p>\n<p>b</p>"],
      ["a<br>\nb", "a<br>\nb"],
      ["one line\n", "one line\n"],
    ])("%j", (input, expected) => {
      expect(sanitizeHtmlPreview(input)).toBe(expected);
    });
  });

  describe("links", () => {
    it.each([
      ['<a href="javascript:alert(1)">Click</a>', "<a>Click</a>"],
      ['<a href="  JaVaScRiPt:alert(1)">Click</a>', "<a>Click</a>"],
      ['<a href="data:text/html,x">Click</a>', "<a>Click</a>"],
      ['<a href="vbscript:x">Click</a>', "<a>Click</a>"],
      ['<a href="file:///etc/passwd">Click</a>', "<a>Click</a>"],
      ['<a href="/relative/path">Click</a>', "<a>Click</a>"],
      [
        '<a href="https://example.com" target="_blank" ping="https://x.example">Click</a>',
        '<a href="https://example.com">Click</a>',
      ],
      [
        '<a href="mailto:team@example.com">Write</a>',
        '<a href="mailto:team@example.com">Write</a>',
      ],
      ['<a href="tel:+491234">Call</a>', '<a href="tel:+491234">Call</a>'],
      [
        '<a href="http://example.com">Open</a>',
        '<a href="http://example.com">Open</a>',
      ],
    ])("%s", (input, expected) => {
      expect(sanitizeHtmlPreview(input)).toBe(expected);
    });

    it("shows the real target when the link text is a different address", () => {
      expect(
        sanitizeHtmlPreview(
          '<a href="https://evil.example/login">https://bank.example/login</a>',
        ),
      ).toBe(
        '<a href="https://evil.example/login">https://evil.example/login</a>',
      );
      expect(
        sanitizeHtmlPreview(
          '<a href="https://evil.example">www.bank.example</a>',
        ),
      ).toBe('<a href="https://evil.example">https://evil.example</a>');
      expect(
        sanitizeHtmlPreview(
          '<a href="mailto:thief@evil.example">help@bank.example</a>',
        ),
      ).toBe('<a href="mailto:thief@evil.example">thief@evil.example</a>');
    });

    it.each([
      ["\u200bhttps://bank.example/login", "https://evil.example/login"],
      ["&lt;https://bank.example&gt;", "https://evil.example/login"],
      ["(https://bank.example)", "https://evil.example/login"],
      ["Visit https://bank.example now", "https://evil.example/login"],
      ["Click <b>https://bank.example</b>", "https://evil.example/login"],
      ["\u202ewww.bank.example", "https://evil.example/login"],
      ["login.bank.example", "https://bank.example.evil.example/"],
      ["https://bank.example", "tel:+491234"],
      ["team@bank.example", "mailto:thief@bank.example"],
    ])("shows the real target behind %j", (text, href) => {
      const doc = new DOMParser().parseFromString(
        sanitizeHtmlPreview(`<a href="${href}">${text}</a>`),
        "text/html",
      );
      expect(doc.body.textContent).toBe(href.replace(/^(?:mailto|tel):/, ""));
    });

    it.each([
      ["Bericht.pdf", "https://files.example.com/s/abc/Bericht.pdf"],
      ["Q3.xlsx", "https://files.example.com/q3"],
      ["example.com", "https://example.com/contact"],
      ["example.com", "https://www.example.com/"],
      ["www.example.com", "https://example.com/"],
      ["Write to team@example.com", "https://example.com/contact"],
      ["example.com", "mailto:team@example.com"],
      ["+49 89 123456", "tel:+4989123456"],
      ["z.B. hier", "https://example.com/"],
    ])("keeps %j linking to %s", (text, href) => {
      const html = `<a href="${href}">${text}</a>`;
      expect(sanitizeHtmlPreview(html)).toBe(html);
    });

    it("keeps link text that names the same address", () => {
      expect(
        sanitizeHtmlPreview('<a href="https://example.com/">example.com</a>'),
      ).toBe('<a href="https://example.com/">example.com</a>');
      expect(
        sanitizeHtmlPreview(
          '<a href="mailto:team@example.com">team@example.com</a>',
        ),
      ).toBe('<a href="mailto:team@example.com">team@example.com</a>');
    });

    it("keeps descriptive link text", () => {
      expect(
        sanitizeHtmlPreview('<a href="https://example.com/x">the agenda</a>'),
      ).toBe('<a href="https://example.com/x">the agenda</a>');
    });
  });
});
