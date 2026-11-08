import { describe, expect, it } from "vitest";

import {
  cleanServerText,
  isHiddenChar,
  isInvisibleFormatChar,
  jsonPreview,
  lastPointerSegment,
  readPointer,
  serverFailureMessage,
} from "./serverText";

/** The backend's table: Default_Ignorable_Code_Point in Unicode 16. */
const DEFAULT_IGNORABLE: [number, number][] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

describe("cleanServerText", () => {
  it("drops control and bidi characters, keeps tabs and two newlines, and trims", () => {
    expect(
      cleanServerText(" a\u202Eb\u2066c\u0007d\te\r\n\n\n\nf\u200F ").text,
    ).toBe("abcd\te\n\nf");
  });

  it("caps by characters and says so", () => {
    expect(cleanServerText("ä".repeat(5), 3)).toEqual({
      text: "äää",
      truncated: true,
      hiddenCharacters: false,
    });
    expect(cleanServerText("abc", 3).truncated).toBe(false);
  });

  it("reads anything but text as empty", () => {
    for (const raw of [undefined, null, 42, { text: "x" }, ["x"], true]) {
      expect(cleanServerText(raw)).toEqual({
        text: "",
        truncated: false,
        hiddenCharacters: false,
      });
    }
  });

  it("reads only the start of a megabyte-long text, and says it was cut", () => {
    const cleaned = cleanServerText("a".repeat(5_000_000), 10);
    expect(cleaned).toEqual({
      text: "a".repeat(10),
      truncated: true,
      hiddenCharacters: false,
    });
    const mostlyDropped = cleanServerText(
      `${"\u202E".repeat(1_000)}visible`,
      10,
    );
    expect(mostlyDropped.truncated).toBe(true);
    expect(mostlyDropped.text).not.toContain("\u202E");
  });

  it("treats exactly the backend's default-ignorable code points as invisible", () => {
    const mismatches: string[] = [];
    for (let code = 0; code <= 0x10ffff; code++) {
      const listed = DEFAULT_IGNORABLE.some(
        ([start, end]) => code >= start && code <= end,
      );
      if (isInvisibleFormatChar(code) !== listed) {
        mismatches.push(code.toString(16));
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each([
    ["the soft hyphen", "\u00AD"],
    ["the combining grapheme joiner", "\u034F"],
    ["the Arabic letter mark", "\u061C"],
    ["a Hangul choseong filler", "\u115F"],
    ["a Hangul jungseong filler", "\u1160"],
    ["a Khmer inherent vowel", "\u17B4"],
    ["a Mongolian free variation selector", "\u180B"],
    ["the Mongolian vowel separator", "\u180E"],
    ["a zero-width space", "\u200B"],
    ["a zero-width non-joiner", "\u200C"],
    ["a zero-width joiner", "\u200D"],
    ["a left-to-right mark", "\u200E"],
    ["a right-to-left mark", "\u200F"],
    ["a bidi embedding", "\u202A"],
    ["a bidi override", "\u202E"],
    ["a word joiner", "\u2060"],
    ["an invisible function application", "\u2061"],
    ["an unassigned default-ignorable", "\u2065"],
    ["a bidi isolate", "\u2066"],
    ["a pop directional isolate", "\u2069"],
    ["a deprecated format character", "\u206F"],
    ["the Hangul filler", "\u3164"],
    ["a variation selector", "\uFE00"],
    ["the last variation selector before the presentation ones", "\uFE0D"],
    ["a byte order mark", "\uFEFF"],
    ["the halfwidth Hangul filler", "\uFFA0"],
    ["a reserved specials code point", "\uFFF0"],
    ["a shorthand format control", "\u{1BCA0}"],
    ["a musical symbol format control", "\u{1D173}"],
    ["the first tag character", "\u{E0000}"],
    ["a tag letter", "\u{E0041}"],
    ["the cancel tag", "\u{E007F}"],
    ["a supplementary variation selector", "\u{E0100}"],
    ["the last default-ignorable", "\u{E0FFF}"],
  ])("removes %s and says the text hid something", (_name, char) => {
    expect(cleanServerText(`pay${char}ee`)).toEqual({
      text: "payee",
      truncated: false,
      hiddenCharacters: true,
    });
  });

  it("hides nothing by dropping control characters or keeping near neighbours", () => {
    expect(cleanServerText("a\u0007b\r\u009Fc")).toEqual({
      text: "abc",
      truncated: false,
      hiddenCharacters: false,
    });
    for (const kept of [
      "\u00AC",
      "\u00AE",
      "\u034E",
      "\u0350",
      "\u061B",
      "\u200A",
      "\u2010",
      "\u2029",
      "\u2070",
      "\uFE10",
      "\uFFF9",
      "\u{1D17B}",
      "\u{E1000}",
      "👩",
    ]) {
      expect(cleanServerText(`x${kept}y`)).toEqual({
        text: `x${kept}y`,
        truncated: false,
        hiddenCharacters: false,
      });
    }
  });

  it.each([
    "I \u2764\uFE0F it",
    "\u2764\uFE0E as text",
    "Sunny \u2600\uFE0F, 25\u00B0C",
    "Press 1\uFE0F\u20E3",
    "\u263A\uFE0F\u2764\uFE0F",
    "\u{1F44D}\u{1F3FD} done",
  ])("keeps a presentation selector right after a character: %s", (text) => {
    expect(cleanServerText(text)).toEqual({
      text,
      truncated: false,
      hiddenCharacters: false,
    });
  });

  it.each([
    ["at the start", "\uFE0Fstart", "start"],
    ["after a space", "a \uFE0Fb", "a b"],
    ["after a line break", "line\n\uFE0Enext", "line\nnext"],
    ["after another selector", "\u2764\uFE0F\uFE0F", "\u2764\uFE0F"],
    ["after a removed character", "a\u200B\uFE0F", "a"],
    ["after a control character", "a\u0007\uFE0Fb", "ab"],
    ["after a lone surrogate", "a\uD800\uFE0F", "a"],
    ["for another variation selector", "\u2764\uFE00", "\u2764"],
  ])("removes a presentation selector %s and says so", (_where, text, kept) => {
    expect(cleanServerText(text)).toEqual({
      text: kept,
      truncated: false,
      hiddenCharacters: true,
    });
  });

  it("reads a selector after a character as the backend's `is_hidden_char` does", () => {
    for (const [previous, char] of [
      ["\u2764", "\uFE0F"],
      ["\u2764", "\uFE0E"],
      ["1", "\uFE0F"],
      ["a", "b"],
      [undefined, "a"],
    ] as const) {
      expect(isHiddenChar(previous, char)).toBe(false);
    }
    for (const [previous, char] of [
      [undefined, "\uFE0F"],
      [" ", "\uFE0F"],
      ["\n", "\uFE0E"],
      ["\u0007", "\uFE0F"],
      ["\u0085", "\uFE0F"],
      ["\u00A0", "\uFE0F"],
      ["\uFE0F", "\uFE0F"],
      ["\u200B", "\uFE0E"],
      ["\u2764", "\uFE00"],
      ["\u2764", "\u{E0100}"],
      ["\u2764", "\u200B"],
    ] as const) {
      expect(isHiddenChar(previous, char)).toBe(true);
    }
  });

  it("reads data smuggled in variation selectors as removed", () => {
    const smuggled = Array.from(new TextEncoder().encode("ignore"), (byte) =>
      String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16),
    ).join("");
    expect(cleanServerText(`Hi \u{1F600}${smuggled}`)).toEqual({
      text: "Hi \u{1F600}",
      truncated: false,
      hiddenCharacters: true,
    });
    expect(cleanServerText("\u{1F600}\uFE0E\uFE0F\uFE0F\uFE0E")).toEqual({
      text: "\u{1F600}\uFE0E",
      truncated: false,
      hiddenCharacters: true,
    });
  });

  it("reads text hidden in tag characters as removed", () => {
    const tagged = Array.from("ignore", (c) =>
      String.fromCodePoint(0xe0000 + c.codePointAt(0)!),
    ).join("");
    expect(cleanServerText(`Invoice${tagged} 42`)).toEqual({
      text: "Invoice 42",
      truncated: false,
      hiddenCharacters: true,
    });
  });

  it("drops half a character pair cut at the end", () => {
    const text = cleanServerText("x".repeat(7) + "😀", 2).text;
    expect(text).toBe("xx");
    expect(cleanServerText("a\uD800b").text).toBe("ab");
  });
});

describe("jsonPreview", () => {
  it("writes compact JSON like JSON.stringify for small values", () => {
    const value = { a: [1, "two", null, true], "b/c": { d: 1.5 } };
    expect(jsonPreview(value, 1_000)).toBe(JSON.stringify(value));
  });

  it("stops early on a huge or deeply nested value", () => {
    const huge = Array.from({ length: 200_000 }, (_, index) => ({ index }));
    expect(jsonPreview(huge, 50).length).toBeLessThan(80);
    let deep: unknown = "end";
    for (let depth = 0; depth < 10_000; depth++) deep = [deep];
    expect(jsonPreview(deep, 1_000)).toContain("[…]");
    expect(jsonPreview("x".repeat(1_000_000), 10).length).toBeLessThan(20);
    expect(jsonPreview(BigInt(7), 10)).toBe("7");
  });
});

describe("pointers", () => {
  const input = { "a/b": { "c~d": ["x", "y"] }, list: [{ id: 7 }] };

  it("reads escaped members and list entries", () => {
    expect(readPointer(input, "/a~1b/c~0d/1")).toBe("y");
    expect(readPointer(input, "/list/0/id")).toBe(7);
    expect(readPointer(input, "")).toBe(input);
    expect(readPointer(input, "/missing")).toBeUndefined();
    expect(readPointer(input, "/list/01")).toBeUndefined();
  });

  it("names the last segment unescaped", () => {
    expect(lastPointerSegment("/a~1b/c~0d")).toBe("c~d");
    expect(lastPointerSegment("")).toBeUndefined();
  });

  it("reads a pointer that is not text as reaching nothing", () => {
    expect(readPointer(input, 5)).toBeUndefined();
    expect(readPointer(input, { path: "/list" })).toBeUndefined();
    expect(readPointer(input, "list")).toBeUndefined();
    expect(lastPointerSegment(null)).toBeUndefined();
  });
});

describe("serverFailureMessage", () => {
  it("reads a text result or the error a JSON result carries", () => {
    expect(serverFailureMessage("Rate limited.")?.text).toBe("Rate limited.");
    expect(serverFailureMessage({ error: "Not found" })?.text).toBe(
      "Not found",
    );
    expect(
      serverFailureMessage({ error: { message: "Expired \u202Etoken" } })?.text,
    ).toBe("Expired token");
    expect(serverFailureMessage({ message: "Denied" })?.text).toBe("Denied");
  });

  it("finds nothing in a result without a sentence", () => {
    expect(serverFailureMessage({ status: "rejected" })).toBeUndefined();
    expect(serverFailureMessage("  ")).toBeUndefined();
    expect(serverFailureMessage(null)).toBeUndefined();
  });

  it("keeps a long message to a few sentences", () => {
    const message = serverFailureMessage("x".repeat(1_000));
    expect(message?.truncated).toBe(true);
    expect(message?.text).toHaveLength(300);
  });
});

describe("serverFailureMessage on odd results", () => {
  it("passes over a candidate with nothing left to show", () => {
    expect(
      serverFailureMessage({ error: "\u202E\u0007", message: "Not found." })
        ?.text,
    ).toBe("Not found.");
    expect(serverFailureMessage({ error: { message: 42 } })).toBeUndefined();
  });
});
