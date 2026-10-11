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
        "⟦1⟧…⟦/1⟧ a link around the text between; that text may change",
        '⟦2⟧ a field showing "2026-10-06"',
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

  it("drops the flattened-emphasis notice with the rewrite when falling back", async () => {
    const selection = await captured({ p: "MX1" });
    expect(selection.flattensEmphasis).toBe(true);
    expect(
      wordSelectionForFacets(selection, advertised(["selected_text"])),
    ).not.toHaveProperty("flattensEmphasis");
  });

  it("names the kind of an item outside the selected part when falling back", async () => {
    const selection = await captured({ p: "FN1", text: "continues" });
    expect(
      wordSelectionForFacets(selection, advertised(["selected_text"])),
    ).toMatchObject({ role: "context_only", reasonCode: "note_reference" });
  });
});
