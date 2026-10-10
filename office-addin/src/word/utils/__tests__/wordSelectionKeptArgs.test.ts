import { afterEach, describe, expect, it } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { wordSelectionForFacets } from "../wordActionFacet";
import { wordKeptItemsArg } from "../wordSelectionArgs";
import { captureWordSelection } from "../wordSelectionCapture";

import type { MockSelectionTarget } from "../../../test/mocks/word/selectionHost";

afterEach(() => uninstallWordSelectionHost());

async function captured(target: MockSelectionTarget) {
  const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: "pc" });
  host.select(target);
  const read = await captureWordSelection();
  if (read.status !== "ok" || !read.value) throw new Error("no capture");
  return read.value;
}

const advertised = (keys: string[]) =>
  new Map([["word_selection", new Set(keys)]]);

describe("kept items for the model", () => {
  it("explains each marker in selected_text", async () => {
    const selection = await captured({ p: "MX1" });
    expect(wordKeptItemsArg(selection)).toBe(
      [
        "⟦1⟧…⟦/1⟧ formatting: bold",
        "⟦2⟧…⟦/2⟧ formatting: italic",
        "⟦3⟧…⟦/3⟧ a link around the text between; that text may change",
        '⟦4⟧ a field showing "2026-10-06"',
      ].join("\n"),
    );
  });

  it("keeps a rewrite with items where the server explains markers", async () => {
    const selection = await captured({ p: "FD1" });
    expect(
      wordSelectionForFacets(
        selection,
        advertised(["selected_text", "kept_items"]),
      ),
    ).toBe(selection);
  });

  it("sends it as context only, with each item's own text, where the server does not", async () => {
    const selection = await captured({ p: "FD1" });
    expect(
      wordSelectionForFacets(selection, advertised(["selected_text"])),
    ).toMatchObject({
      role: "context_only",
      reasonCode: "field",
      selectedText: "FD1 Field before 2026-10-06 field after words.",
      paragraphs: [expect.not.objectContaining({ kept: expect.anything() })],
    });
  });

  it("drops the format spans and the flattened-emphasis notice with the rewrite when falling back", async () => {
    const selection = await captured({ p: "MX1" });
    expect(selection.paragraphs[0].formats?.spans).toHaveLength(2);
    const fallback = wordSelectionForFacets(
      { ...selection, flattensEmphasis: true },
      advertised(["selected_text"]),
    );
    expect(fallback).not.toHaveProperty("flattensEmphasis");
    expect(fallback).toMatchObject({
      role: "context_only",
      selectedText:
        "MX1 Alpha bravo charlie delta echo foxtrot link golf 2026-10-06 hotel india.",
      paragraphs: [expect.not.objectContaining({ formats: expect.anything() })],
    });
  });

  it("keeps a rewrite with only format spans where the server does not explain markers, without them", async () => {
    installWordSelectionHost(
      {
        body: [
          "Intro.",
          {
            runs: ["One ", { text: "bold", font: { bold: true } }, " word."],
          },
        ],
      },
      { host: "pc" },
    ).select({ paragraph: 1 });
    const read = await captureWordSelection();
    if (read.status !== "ok" || !read.value) throw new Error("no capture");
    expect(read.value).toMatchObject({
      role: "rewrite",
      selectedText: "One ⟦1⟧bold⟦/1⟧ word.",
    });
    expect(wordKeptItemsArg(read.value)).toBe("⟦1⟧…⟦/1⟧ formatting: bold");
    const fallback = wordSelectionForFacets(
      read.value,
      advertised(["selected_text"]),
    );
    expect(fallback).toMatchObject({
      role: "rewrite",
      selectedText: "One bold word.",
      flattensEmphasis: true,
      paragraphs: [expect.not.objectContaining({ formats: expect.anything() })],
    });
    expect(wordKeptItemsArg(fallback)).toBe("");
  });

  it("keeps a rewrite without markers where the server does not explain them", async () => {
    const selection = await captured({ p: "FN1", text: "continues" });
    expect(selection.paragraphs[0].kept?.markers).toEqual([]);
    expect(
      wordSelectionForFacets(selection, advertised(["selected_text"])),
    ).toBe(selection);
  });

  it("names the first marked item's kind when falling back", async () => {
    const selection = await captured({ p: "MX1" });
    expect(
      wordSelectionForFacets(selection, advertised(["selected_text"])),
    ).toMatchObject({ role: "context_only", reasonCode: "hyperlink" });
  });

  it("never mentions a bookmark, which gets no marker", async () => {
    const host = installWordSelectionHost(
      {
        body: [
          {
            runs: [
              { text: "H1 Selection probe heading", bookmark: "_Toc938001" },
            ],
            style: "Heading 1",
          },
          ...SV2_MAIN_DOCUMENT.body.slice(1),
        ],
      },
      { host: "pc" },
    );
    host.select({ p: "H1" });
    const read = await captureWordSelection();
    if (read.status !== "ok" || !read.value) throw new Error("no capture");
    expect(read.value).toMatchObject({
      role: "rewrite",
      selectedText: "H1 Selection probe heading",
    });
    expect(wordKeptItemsArg(read.value)).toBe("");
    expect(
      wordSelectionForFacets(read.value, advertised(["selected_text"])),
    ).toBe(read.value);
  });
});
