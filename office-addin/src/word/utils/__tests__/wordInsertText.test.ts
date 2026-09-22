import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { insertWordTextAtCursor } from "../wordInsertText";

import type { MockWordHost } from "../../../test/mocks/word/document";

describe("insertWordTextAtCursor", () => {
  let word: MockWordHost;

  beforeEach(() => {
    word = installMockWordDocument([{ text: "Alpha." }]);
  });
  afterEach(() => {
    uninstallMockWordDocument();
    vi.restoreAllMocks();
  });

  it("inserts at a collapsed insertion point", async () => {
    word.word.setSelection("");

    await expect(insertWordTextAtCursor("Drafted text.")).resolves.toBe(true);
    expect(word.word.writes()).toEqual([
      {
        kind: "insertText",
        target: "selection",
        ordinal: 0,
        value: "Drafted text.",
        location: "Replace",
      },
    ]);
  });

  it("NEVER replaces a non-empty selection — it inserts after it", async () => {
    // Replacing a selection is `word.replace_selection`, which is v2. Doing it
    // here would silently destroy the user's highlighted text.
    word.word.setSelection("A passage the user highlighted");

    await expect(insertWordTextAtCursor("Drafted text.")).resolves.toBe(true);
    expect(word.word.writes()[0].location).toBe("After");
  });

  it("reports failure rather than throwing when the host rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    word.word.run.mockRejectedValueOnce(new Error("GeneralException"));

    await expect(insertWordTextAtCursor("Drafted text.")).resolves.toBe(false);
  });

  it("fails closed with no Word host at all", async () => {
    uninstallMockWordDocument();
    await expect(insertWordTextAtCursor("Drafted text.")).resolves.toBe(false);
  });
});
