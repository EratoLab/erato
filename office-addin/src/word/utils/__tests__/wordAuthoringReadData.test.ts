import { describe, expect, it } from "vitest";

import { wordReadableSourceBlock } from "../wordAuthoringReadData";

import type { WordSourceBlock } from "../wordDocumentPlan";

const source = (): WordSourceBlock => ({
  ref: "b1",
  type: "paragraph",
  text: "The complete paragraph.",
  protected: false,
  xml: "<w:p>host-only native content</w:p>",
  paragraphOrdinal: 5,
  format: {
    alignment: "center",
    spacingAfter: 8,
    font: { bold: true, color: "112233", fontFamily: "Arial" },
  },
  runs: [
    {
      text: "The complete paragraph.",
      bold: false,
      italic: true,
      fontSize: 12,
    },
  ],
});

describe("model-facing Word source projection", () => {
  it("merges uniform run formatting over paragraph defaults while removing only duplicated text", () => {
    const original = source();
    const untouched = globalThis.structuredClone(original);
    const result = wordReadableSourceBlock(original);
    expect(result).toEqual({
      ref: "b1",
      type: "paragraph",
      text: "The complete paragraph.",
      protected: false,
      format: {
        alignment: "center",
        spacingAfter: 8,
        font: {
          bold: false,
          color: "112233",
          fontFamily: "Arial",
          italic: true,
          fontSize: 12,
        },
      },
    });
    expect(original).toEqual(untouched);
    expect(result).not.toHaveProperty("runs");
    expect(result).not.toHaveProperty("xml");
    expect(result).not.toHaveProperty("paragraphOrdinal");
  });

  it("retains mixed run boundaries and explicit false marks exactly", () => {
    const original = source();
    original.runs = [
      { text: "The complete", bold: false },
      { text: " paragraph.", bold: true },
    ];
    const result = wordReadableSourceBlock(original);
    expect(result.runs).toEqual(original.runs);
    expect(result.format).toEqual(original.format);
    expect(result.text).toBe(original.text);
  });

  it("does not compact an incomplete run or native object's text into paragraph formatting", () => {
    const original = source();
    original.runs = [{ text: "The complete", bold: false }];
    expect(wordReadableSourceBlock(original).runs).toEqual(original.runs);
    original.type = "native";
    original.nativeKind = "table";
    original.runs = [{ text: original.text, bold: false }];
    expect(wordReadableSourceBlock(original).runs).toEqual(original.runs);
  });

  it("preserves empty paragraph formatting and list ownership during compaction", () => {
    const original = source();
    original.type = "list-item";
    original.text = "";
    original.level = 2;
    original.list = "existing-7";
    original.ordered = true;
    original.runs = [{ text: "", color: "AABBCC", underline: false }];
    expect(wordReadableSourceBlock(original)).toMatchObject({
      type: "list-item",
      level: 2,
      list: "existing-7",
      ordered: true,
      text: "",
      format: { font: { color: "AABBCC", underline: false } },
    });
  });
});
