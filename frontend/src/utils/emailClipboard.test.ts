import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyEmailToClipboard,
  htmlToPlainText,
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
    expect(htmlToPlainText("<p>Hi Anna,</p><p>Thanks for the update.</p>")).toBe(
      "Hi Anna,\n\nThanks for the update.",
    );
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
      htmlToPlainText("<style>p{margin:0}</style><p>Hello</p><script>x()</script>"),
    ).toBe("Hello");
  });

  it("collapses excess blank lines from pretty-printed markup", () => {
    expect(htmlToPlainText("<p>A</p>\n\n  <p>B</p>")).toBe("A\n\nB");
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

  it("leaves messages without email fences unchanged", () => {
    const text = "Just a normal answer with `inline code`.\n\n```ts\nconst x = 1;\n```";
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
