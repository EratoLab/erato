import { describe, expect, it } from "vitest";

import {
  cleanServerText,
  jsonPreview,
  lastPointerSegment,
  readPointer,
  serverFailureMessage,
} from "./serverText";

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

  it.each([
    ["the Arabic letter mark", "\u061C"],
    ["a zero-width space", "\u200B"],
    ["a zero-width non-joiner", "\u200C"],
    ["a zero-width joiner", "\u200D"],
    ["a left-to-right mark", "\u200E"],
    ["a right-to-left mark", "\u200F"],
    ["a bidi embedding", "\u202A"],
    ["a bidi override", "\u202E"],
    ["a word joiner", "\u2060"],
    ["a bidi isolate", "\u2066"],
    ["a pop directional isolate", "\u2069"],
    ["a byte order mark", "\uFEFF"],
    ["the first tag character", "\u{E0000}"],
    ["a tag letter", "\u{E0041}"],
    ["the cancel tag", "\u{E007F}"],
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
      "\u061B",
      "\u200A",
      "\u2010",
      "\u2029",
      "\u2061",
      "\u{E0080}",
      "👩",
    ]) {
      expect(cleanServerText(`x${kept}`).hiddenCharacters).toBe(false);
    }
    expect(cleanServerText("x\u{E0080}").text).toBe("x\u{E0080}");
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
