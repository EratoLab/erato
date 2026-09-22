import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { readWordDocument } from "../readWordDocument";

import type { MockWordHost } from "../../../test/mocks/word/document";

describe("readWordDocument", () => {
  let word: MockWordHost;

  afterEach(() => {
    uninstallMockWordDocument();
  });

  beforeEach(() => {
    word = installMockWordDocument([
      { text: "The Annual Report", styleBuiltIn: "Title", outlineLevel: 1 },
      { text: "" },
      { text: "Revenue grew.", uniqueLocalId: "para-revenue" },
    ]);
  });

  it("returns every paragraph with its ordinal, text, id and style", async () => {
    const result = await readWordDocument();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toEqual([
      {
        ordinal: 1,
        text: "The Annual Report",
        uniqueLocalId: "id-1",
        styleBuiltIn: "Title",
        outlineLevel: 1,
      },
      {
        ordinal: 2,
        text: "",
        uniqueLocalId: "id-2",
        styleBuiltIn: "Normal",
        outlineLevel: 10,
      },
      {
        ordinal: 3,
        text: "Revenue grew.",
        uniqueLocalId: "para-revenue",
        styleBuiltIn: "Normal",
        outlineLevel: 10,
      },
    ]);
  });

  it("reads the ids and the text inside ONE Word.run", async () => {
    await readWordDocument();

    expect(word.word.run).toHaveBeenCalledTimes(1);
    expect(word.word.syncCount()).toBe(2);
  });

  it("resolves to a failure when the run rejects", async () => {
    word.word.run.mockRejectedValueOnce(new Error("GeneralException"));

    await expect(readWordDocument()).resolves.toEqual({ ok: false });
  });

  it("resolves to a failure when the host exposes no Word namespace", async () => {
    delete (globalThis as Record<string, unknown>).Word;

    await expect(readWordDocument()).resolves.toEqual({ ok: false });
  });

  it("resolves to a failure when Word.run is not callable", async () => {
    (globalThis as Record<string, unknown>).Word = {};

    await expect(readWordDocument()).resolves.toEqual({ ok: false });
  });
});
