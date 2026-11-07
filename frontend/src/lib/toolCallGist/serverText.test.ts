import { describe, expect, it } from "vitest";

import {
  cleanServerText,
  lastPointerSegment,
  readPointer,
  readPointerAll,
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
    });
    expect(cleanServerText("abc", 3).truncated).toBe(false);
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

  it("reads every element a wildcard stands for, and skips what is missing", () => {
    const input = {
      changes: [{ op: "reply" }, { op: null }, {}, { op: "resolve" }],
      ids: { a: "x", b: "y" },
    };
    expect(readPointerAll(input, "/changes/*/op")).toEqual([
      "reply",
      null,
      "resolve",
    ]);
    expect(readPointerAll(input, "/ids/*")).toEqual(["x", "y"]);
    expect(readPointerAll(input, "/changes/3/op")).toEqual(["resolve"]);
    expect(readPointerAll(input, "/missing/*")).toEqual([]);
    expect(readPointerAll(input, "changes")).toEqual([]);
  });

  it("names the last segment unescaped", () => {
    expect(lastPointerSegment("/a~1b/c~0d")).toBe("c~d");
    expect(lastPointerSegment("")).toBeUndefined();
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
