import { beforeEach, describe, expect, it, vi } from "vitest";

import { sixParagraphXml } from "../../../test/mocks/word/authoringFixtures";
import { readWordDocument } from "../readWordDocument";
import {
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  resetWordChangeJournalForTests,
  wordChangePosition,
} from "../wordChangeJournal";
import { captureWordDocumentForRequest } from "../wordRequestCapture";

vi.mock("../readWordDocument", () => ({ readWordDocument: vi.fn() }));
vi.mock("../wordDocumentChangeSignal", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  wordParagraphEventsPending: () => undefined,
}));

const paragraphs = [
  {
    ordinal: 1,
    text: "Alpha\r",
    uniqueLocalId: "p-1",
    styleBuiltIn: "Normal",
    outlineLevel: 10,
  },
];

beforeEach(() => {
  resetWordChangeJournalForTests();
  noteWordChangeEventsActive();
  vi.mocked(readWordDocument).mockReset();
  vi.mocked(readWordDocument).mockResolvedValue({
    ok: true,
    paragraphs,
    tracking: "Off",
    authoring: { ooxml: sixParagraphXml(), tracking: "Off" },
  });
});

describe("the capture an answer takes after an applied change", () => {
  it("stands on the verified body without reading it again while nothing changed since", async () => {
    const verified = {
      ooxml: sixParagraphXml(),
      tracking: "Off",
      position: wordChangePosition(),
    };
    const taken = await captureWordDocumentForRequest("doc-A", verified);
    expect(taken?.reusedVerifiedBody).toBe(true);
    expect(readWordDocument).toHaveBeenCalledTimes(1);
    expect(readWordDocument).toHaveBeenCalledWith(false);
    expect(taken?.snapshot.blocks.length).toBeGreaterThan(0);
    expect(taken?.capture.ordinalMap?.size).toBe(1);
  });

  it("reads the whole document again once someone changed it", async () => {
    const verified = {
      ooxml: sixParagraphXml(),
      tracking: "Off",
      position: wordChangePosition(),
    };
    recordWordParagraphEvent({
      type: "ParagraphChanged",
      source: "Local",
      uniqueLocalIds: ["p-1"],
    });
    const taken = await captureWordDocumentForRequest("doc-A", verified);
    expect(taken?.reusedVerifiedBody).toBe(false);
    expect(readWordDocument).toHaveBeenCalledWith(true);
    expect(readWordDocument).not.toHaveBeenCalledWith(false);
  });

  it("reads the whole document where the write had no verify read", async () => {
    const taken = await captureWordDocumentForRequest("doc-A");
    expect(taken?.reusedVerifiedBody).toBe(false);
    expect(readWordDocument).toHaveBeenCalledWith(true);
  });
});
