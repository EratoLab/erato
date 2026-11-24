import { describe, expect, it } from "vitest";

import { sortSharedItems } from "./sharedItems";

describe("sortSharedItems", () => {
  it("shows a page address once when the text already contains it", () => {
    const sorted = sortSharedItems({
      batches: [
        {
          id: "a",
          createdAt: "2026-11-24T15:35:01Z",
          items: [
            { kind: "url", url: "https://example.com/" },
            { kind: "text", text: "Example Domain https://example.com/" },
          ],
        },
        {
          id: "b",
          createdAt: "2026-11-24T15:36:01Z",
          items: [{ kind: "url", url: "https://example.com/" }],
        },
      ],
    });

    expect(sorted.texts).toEqual(["Example Domain https://example.com/"]);
  });

  it("keeps an empty-content file name and size", () => {
    const sorted = sortSharedItems({
      batches: [
        {
          id: "a",
          createdAt: "2026-11-24T15:35:01Z",
          items: [{ kind: "file", fileName: "big.mov", size: 11_000_000 }],
        },
      ],
    });

    expect(sorted.files).toEqual([]);
    expect(sorted.filesWithoutContent).toEqual([
      { name: "big.mov", size: 11_000_000 },
    ]);
  });

  it("keeps a link that is only the start of an address in the text", () => {
    const sorted = sortSharedItems({
      batches: [
        {
          items: [
            { kind: "url", url: "https://example.com/a" },
            { kind: "text", text: "See https://example.com/abc" },
          ],
        },
      ],
    });

    expect(sorted.texts).toEqual([
      "https://example.com/a",
      "See https://example.com/abc",
    ]);
  });

  it("skips what it cannot read and names a file it cannot decode", () => {
    expect(sortSharedItems(null)).toEqual({
      texts: [],
      files: [],
      filesWithoutContent: [],
    });
    const sorted = sortSharedItems({
      batches: [
        "nonsense",
        { items: [null, { kind: "image" }, { kind: "text", text: "  " }] },
        {
          items: [
            { kind: "file", fileName: "broken.bin", size: 3, data: "%%%" },
          ],
        },
      ],
    });
    expect(sorted).toEqual({
      texts: [],
      files: [],
      filesWithoutContent: [{ name: "broken.bin", size: 3 }],
    });
  });
});
