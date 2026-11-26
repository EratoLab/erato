import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyEmailToClipboard,
  emailDraftHtmlToText,
  htmlToPlainText,
  isEmailDraftHtml,
  transformEmailFencesForCopy,
} from "./emailClipboard";

describe("htmlToPlainText", () => {
  it("strips simple HTML tags", () => {
    expect(htmlToPlainText("<p>Hello</p>")).toBe("Hello");
  });

  it("handles nested tags", () => {
    expect(htmlToPlainText("<div><b>Bold</b> and <i>italic</i></div>")).toBe(
      "Bold and italic",
    );
  });

  it("returns empty string for empty input", () => {
    expect(htmlToPlainText("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(htmlToPlainText("no tags here")).toBe("no tags here");
  });

  it("decodes HTML entities", () => {
    expect(htmlToPlainText("&amp; &lt; &gt;")).toBe("& < >");
  });

  it("emits a newline for <br>", () => {
    expect(htmlToPlainText("line one<br/>line two")).toBe("line one\nline two");
  });

  it("separates adjacent block elements", () => {
    expect(
      htmlToPlainText("<p>Hi Anna,</p><p>Thanks for the update.</p>"),
    ).toBe("Hi Anna,\n\nThanks for the update.");
  });

  it("separates list items", () => {
    expect(htmlToPlainText("<ul><li>one</li><li>two</li></ul>")).toBe(
      "one\n\ntwo",
    );
  });

  it("keeps a sign-off line break", () => {
    expect(htmlToPlainText("<p>Best regards,<br>Daniel</p>")).toBe(
      "Best regards,\nDaniel",
    );
  });

  it("skips style and script content", () => {
    expect(
      htmlToPlainText(
        "<style>p{margin:0}</style><p>Hello</p><script>x()</script>",
      ),
    ).toBe("Hello");
  });

  it("collapses excess blank lines from pretty-printed markup", () => {
    expect(htmlToPlainText("<p>A</p>\n\n  <p>B</p>")).toBe("A\n\nB");
  });

  it("separates table cells", () => {
    expect(
      htmlToPlainText(
        "<table><tr><td>Price</td><td>40</td></tr><tr><td>Tax</td><td>5</td></tr></table>",
      ),
    ).toBe("Price | 40\nTax | 5");
  });

  it("separates header cells and cells holding block content", () => {
    expect(
      htmlToPlainText(
        "<table>\n  <tr>\n    <th>Item</th>\n    <th>Qty</th>\n  </tr>\n  <tr>\n    <td><p>Bolt</p></td>\n    <td>7</td>\n  </tr>\n</table>",
      ),
    ).toBe("Item | Qty\nBolt | 7");
  });

  it("keeps a row whose first cell is empty on its own line", () => {
    // The ordinary shape of a pasted cross-tab. The empty cell must hold its
    // column rather than letting the next one weld onto the row above.
    expect(
      htmlToPlainText(
        "<table><tr><th>Name</th><th>Qty</th></tr><tr><td></td><td>7</td></tr><tr><td>Nut</td><td>9</td></tr></table>",
      ),
    ).toBe("Name | Qty\n| 7\nNut | 9");
  });

  it("does not weld prose onto a following table cell", () => {
    expect(
      htmlToPlainText(
        "<p>Summary</p><table><tr><td></td><td>X</td></tr></table>",
      ),
    ).toBe("Summary\n| X");
  });

  it("keeps adjacent tables apart", () => {
    expect(
      htmlToPlainText(
        "<table><tr><td>a</td><td>b</td></tr></table><table><tr><td></td><td>c</td></tr></table>",
      ),
    ).toBe("a | b\n| c");
  });

  it("keeps indentation and blank lines inside a code fence", () => {
    const code =
      "```\ndef f(x):\n    if x:\n\n        return 1\n    return 0\n```";
    expect(htmlToPlainText(`<div>${code}</div>`)).toBe(code);
  });
});

describe("emailDraftHtmlToText", () => {
  it.each([
    [
      "paragraphs",
      "<p>Hi Anna,</p><p>Thanks for the update.</p>",
      "Hi Anna,\n\nThanks for the update.",
    ],
    ["line breaks", "<p>Best regards,<br>Sam</p>", "Best regards,\nSam"],
    ["two line breaks", "<p>one<br><br>two</p>", "one\n\ntwo"],
    ["divs as lines", "<div>one</div><div>two</div>", "one\ntwo"],
    [
      "unordered list",
      "<p>Points:</p><ul><li>one</li><li>two</li></ul><p>End</p>",
      "Points:\n\n- one\n- two\n\nEnd",
    ],
    [
      "ordered list",
      "<ol><li>first</li><li>second</li><li>third</li></ol>",
      "1. first\n2. second\n3. third",
    ],
    [
      "nested list",
      "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>",
      "- a\n  - a1\n  - a2\n- b",
    ],
    [
      "ordered inside unordered",
      "<ul><li>a<ol><li>x</li><li>y</li></ol></li></ul>",
      "- a\n  1. x\n  2. y",
    ],
    [
      "list item paragraphs",
      "<ol><li><p>first</p></li><li><p>second</p><p>more</p></li></ol>",
      "1. first\n2. second\n   more",
    ],
    [
      "link",
      '<p>See <a href="https://example.com/a">the agenda</a>.</p>',
      "See the agenda (https://example.com/a).",
    ],
    [
      "link named by its url",
      '<p><a href="https://example.com/">https://example.com</a></p>',
      "https://example.com",
    ],
    [
      "link without text",
      '<p><a href="https://example.com/a"></a></p>',
      "https://example.com/a",
    ],
    [
      "mail link",
      '<p><a href="mailto:team@example.com">Write to us</a></p>',
      "Write to us (team@example.com)",
    ],
    [
      "mail link named by its address",
      '<p><a href="mailto:team@example.com">team@example.com</a></p>',
      "team@example.com",
    ],
    [
      "phone link",
      '<p><a href="tel:+491234">Call us</a></p>',
      "Call us (+491234)",
    ],
    [
      "quote",
      "<p>You wrote:</p><blockquote><p>one</p><p>two</p></blockquote>",
      "You wrote:\n\n> one\n>\n> two",
    ],
    [
      "nested quote",
      "<blockquote>a<blockquote>b</blockquote></blockquote>",
      "> a\n>\n> > b",
    ],
    ["heading", "<h2>Agenda</h2><p>Text</p>", "Agenda\n\nText"],
    [
      "inline heading neighbours",
      "intro<h3>Title</h3>outro",
      "intro\n\nTitle\n\noutro",
    ],
    [
      "table",
      "<table><tr><th>Item</th><th>Qty</th></tr><tr><td><p>Bolt</p></td><td>7</td></tr></table>",
      "Item | Qty\nBolt | 7",
    ],
    [
      "bold and italic",
      "<p><strong>Note:</strong> <em>today</em> <b>only</b> <i>here</i></p>",
      "Note: today only here",
    ],
    ["non-breaking spaces", "<p>a&nbsp;b\u00a0c</p>", "a b c"],
    [
      "entities",
      "<p>&amp; &lt;tag&gt; &quot;q&quot; &#39;s&#39; &euro;</p>",
      "& <tag> \"q\" 's' \u20ac",
    ],
    ["blank-line runs", "<p>a</p><p></p><br><br><p>b</p>", "a\n\nb"],
    ["trailing spaces", "<p>a   </p><p>b &nbsp;</p>", "a\n\nb"],
    [
      "pretty-printed markup",
      "<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>\n",
      "- one\n- two",
    ],
    ["preformatted text", "<pre>a\n  b</pre>", "a\n  b"],
    ["plain text input", "no tags here", "no tags here"],
    ["empty input", "", ""],
  ])("%s", (_name, html, expected) => {
    expect(emailDraftHtmlToText(html)).toBe(expected);
  });

  it("drops what the cleaner drops and shows hidden text", () => {
    expect(
      emailDraftHtmlToText(
        '<style>p{display:none}</style><p>Hi</p><script>x()</script><p style="display:none">secret</p><img src="https://x.example/p.gif" alt="pixel">',
      ),
    ).toBe("Hi\n\nsecret");
  });

  it("shows the real target of a spoofed link once", () => {
    expect(
      emailDraftHtmlToText(
        '<p><a href="https://evil.example">https://bank.example</a></p>',
      ),
    ).toBe("https://evil.example");
  });

  it("drops an unsafe link target", () => {
    expect(
      emailDraftHtmlToText('<p><a href="javascript:x()">Click</a></p>'),
    ).toBe("Click");
  });
});

describe("isEmailDraftHtml", () => {
  it.each<[string, Parameters<typeof isEmailDraftHtml>[1], boolean]>([
    ["<p>Hi</p>", { language: "erato-email" }, true],
    ["<p>Hi</p>", { language: "erato-email", bodyFormat: "text" }, true],
    ["  \n<div>Hi</div>", {}, true],
    ["<ul><li>a</li></ul>", { bodyFormat: "text" }, true],
    ['<a href="https://example.com">x</a> more', {}, true],
    ["<br>", {}, true],
    ["Hi <b>there</b>", { language: "erato-email-html" }, true],
    ["Hi <b>there</b>", { bodyFormat: "html" }, true],
    ["Hi <b>there</b>", { language: "erato-email" }, false],
    ["Hi <b>there</b>", { language: "erato-email", bodyFormat: "text" }, false],
    ["Hi there", { language: "erato-email-html" }, false],
    ["Hi there", { bodyFormat: "html" }, false],
    ["<Name> please call me", { bodyFormat: "html" }, false],
    ["<team@example.com> wrote", { language: "erato-email-html" }, false],
    ["<30 units left", {}, false],
    ["<paragraph> is a word", {}, false],
  ])("%j %j", (content, options, expected) => {
    expect(isEmailDraftHtml(content, options)).toBe(expected);
  });
});

describe("transformEmailFencesForCopy", () => {
  it("unwraps a plain erato-email fence to its body", () => {
    expect(
      transformEmailFencesForCopy(
        "Here is your draft:\n\n```erato-email\nHallo Frau Berger,\n\nvielen Dank.\n```\n\nLet me know.",
      ),
    ).toBe(
      "Here is your draft:\n\nHallo Frau Berger,\n\nvielen Dank.\n\nLet me know.",
    );
  });

  it("converts an erato-email-html fence to readable plain text", () => {
    expect(
      transformEmailFencesForCopy(
        "```erato-email-html\n<p>Hi Anna,</p><p>Thanks</p>\n```",
      ),
    ).toBe("Hi Anna,\n\nThanks");
  });

  it("converts lists and links in an erato-email-html fence", () => {
    expect(
      transformEmailFencesForCopy(
        '```erato-email-html\n<ul><li>one</li><li><a href="https://example.com/a">two</a></li></ul>\n```',
      ),
    ).toBe("- one\n- two (https://example.com/a)");
  });

  it("converts an erato-email fence whose body starts with a tag", () => {
    expect(
      transformEmailFencesForCopy("```erato-email\n<p>Hi</p><p>Bye</p>\n```"),
    ).toBe("Hi\n\nBye");
  });

  it("leaves messages without email fences unchanged", () => {
    const text =
      "Just a normal answer with `inline code`.\n\n```ts\nconst x = 1;\n```";
    expect(transformEmailFencesForCopy(text)).toBe(text);
  });

  it("leaves drifted tags untouched (classification needs facet context)", () => {
    const text = "```email\n<b>Bold reply</b>\n```";
    expect(transformEmailFencesForCopy(text)).toBe(text);
  });

  it("transforms multiple fences independently", () => {
    expect(
      transformEmailFencesForCopy(
        "```erato-email\nfirst\n```\nand\n```erato-email-html\n<p>second</p>\n```",
      ),
    ).toBe("first\nand\nsecond");
  });
});

describe("copyEmailToClipboard", () => {
  class ClipboardItemStub {
    constructor(public data: Record<string, Blob>) {}
  }

  const write = vi.fn();
  const writeText = vi.fn();

  const readBlob = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      // jsdom's Blob has no .text(), so read via FileReader.
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

  beforeEach(() => {
    write.mockResolvedValue(undefined);
    writeText.mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write, writeText } });
    vi.stubGlobal("ClipboardItem", ClipboardItemStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("writes plain-text drafts via writeText", async () => {
    await copyEmailToClipboard("hello there", false);
    expect(writeText).toHaveBeenCalledWith("hello there");
    expect(write).not.toHaveBeenCalled();
  });

  it("writes html drafts as text/html plus a plain-text flavor", async () => {
    await copyEmailToClipboard("<p>Hi Anna,</p><p>Thanks</p>", true);
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as ClipboardItemStub;
    expect(Object.keys(item.data).sort()).toEqual(["text/html", "text/plain"]);
    expect(item.data["text/html"].type).toBe("text/html");
    expect(item.data["text/plain"].type).toBe("text/plain");
    expect(await readBlob(item.data["text/plain"])).toBe("Hi Anna,\n\nThanks");
  });

  it("writes lists and links into the plain-text flavor", async () => {
    await copyEmailToClipboard(
      '<ol><li>one</li><li><a href="https://example.com/a">two</a></li></ol>',
      true,
    );
    const item = write.mock.calls[0][0][0] as ClipboardItemStub;
    expect(await readBlob(item.data["text/plain"])).toBe(
      "1. one\n2. two (https://example.com/a)",
    );
  });

  it("copies the same cleaned html the card shows", async () => {
    const draft =
      '<p style="color:#fff">Hi</p><img src="https://x.example/p.gif"><a href="https://evil.example">https://bank.example</a>';
    await copyEmailToClipboard(draft, true);
    const item = write.mock.calls[0][0][0] as ClipboardItemStub;
    expect(await readBlob(item.data["text/html"])).toBe(
      '<p>Hi</p><a href="https://evil.example">https://evil.example</a>',
    );
  });

  it("sanitizes the text/html flavor like the preview", async () => {
    await copyEmailToClipboard(
      '<p>Hi</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
      true,
    );
    const item = write.mock.calls[0][0][0] as ClipboardItemStub;
    const html = await readBlob(item.data["text/html"]);
    expect(html).toContain("<p>Hi</p>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
  });

  it("falls back to stripped writeText when ClipboardItem is unavailable", async () => {
    vi.unstubAllGlobals();
    await copyEmailToClipboard("<p>Hi Anna,</p><p>Thanks</p>", true);
    expect(writeText).toHaveBeenCalledWith("Hi Anna,\n\nThanks");
    expect(write).not.toHaveBeenCalled();
  });
});
