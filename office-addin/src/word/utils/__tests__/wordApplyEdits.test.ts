import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { applyWordEdits, revertWordEdits } from "../wordApplyEdits";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type { WordDocumentCapture } from "../wordDocumentCapture";

const IDENTITY = "https://contoso.sharepoint.com/report.docx";

const captureOf = (
  texts: string[],
  paragraphsSent = texts.length,
): WordDocumentCapture => ({
  identity: IDENTITY,
  ordinalMap: new Map(
    texts.map((text, index) => [
      index + 1,
      { uniqueLocalId: `id-${index + 1}`, text },
    ]),
  ),
  paragraphsSent,
  renderedOrdinals: new Set(
    texts
      .map((text, index) => ({ ordinal: index + 1, text }))
      .filter(
        (entry) =>
          entry.ordinal <= paragraphsSent && entry.text.trim().length > 0,
      )
      .map((entry) => entry.ordinal),
  ),
  partialOrdinal: null,
});

describe("applyWordEdits", () => {
  let word: MockWordHost;
  const texts = ["Alpha.", "Bravo.", "Charlie.", "Delta."];

  beforeEach(() => {
    word = installMockWordDocument(texts.map((text) => ({ text })));
  });
  afterEach(() => {
    uninstallMockWordDocument();
    vi.restoreAllMocks();
  });

  const bodyText = () => word.word.paragraphs().map((entry) => entry.text);

  it("applies a single edit and reports it", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo, revised." }],
      capture: captureOf(texts),
    });

    expect(bodyText()).toEqual([
      "Alpha.",
      "Bravo, revised.",
      "Charlie.",
      "Delta.",
    ]);
    expect(result.outcomes).toEqual([
      { index: 0, paragraph: 2, status: "applied", excerpt: "Bravo, revised." },
    ]);
    expect(result.snapshotOoxml).not.toBeNull();
    expect(result.hostFailed).toBe(false);
  });

  it("applies in DESCENDING document order", async () => {
    await applyWordEdits({
      edits: [
        { paragraph: 1, text: "First." },
        { paragraph: 3, text: "Third." },
        { paragraph: 2, text: "Second." },
      ],
      capture: captureOf(texts),
    });

    // The queue order is the discriminating assertion: with ids resolved at
    // execution time the RESULT is order-independent, so only the order the
    // commands were issued in can prove the rule holds.
    expect(
      word.word
        .writes()
        .filter((write) => write.kind === "insertText")
        .map((write) => write.target),
    ).toEqual(["id-3", "id-2", "id-1"]);
  });

  it("lands a later-ordinal edit correctly after an earlier one split paragraphs", async () => {
    await applyWordEdits({
      edits: [
        { paragraph: 1, text: "One.\nOne and a half." },
        { paragraph: 3, text: "Charlie, revised." },
      ],
      capture: captureOf(texts),
    });

    expect(bodyText()).toEqual([
      "One.",
      "One and a half.",
      "Bravo.",
      "Charlie, revised.",
      "Delta.",
    ]);
  });

  it("replaces a range with one paragraph, keeping the head's style", async () => {
    uninstallMockWordDocument();
    word = installMockWordDocument([
      { text: "Alpha.", styleBuiltIn: "Heading1" },
      { text: "Bravo." },
      { text: "Charlie." },
    ]);

    await applyWordEdits({
      edits: [{ paragraph: 1, through: 3, text: "All three, merged." }],
      capture: captureOf(["Alpha.", "Bravo.", "Charlie."]),
    });

    expect(bodyText()).toEqual(["All three, merged."]);
    // D-31: no style is assigned by the executor — the head paragraph keeps
    // the one the document already gave it.
    expect(
      word.word.writes().filter((write) => write.kind === "style"),
    ).toEqual([]);
  });

  it("skips a paragraph that changed and still applies the rest", async () => {
    word.word.setParagraphs([
      { text: "Alpha." },
      { text: "Bravo, edited by the user." },
      { text: "Charlie." },
      { text: "Delta." },
    ]);

    const result = await applyWordEdits({
      edits: [
        { paragraph: 2, text: "Never written." },
        { paragraph: 3, text: "Charlie, revised." },
      ],
      capture: captureOf(texts),
    });

    expect(bodyText()[1]).toBe("Bravo, edited by the user.");
    expect(bodyText()[2]).toBe("Charlie, revised.");
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "changed",
      "applied",
    ]);
  });

  it("writes nothing and takes NO snapshot when no edit is applicable", async () => {
    word.word.setParagraphs(texts.map((text) => ({ text: `${text} Edited.` })));

    const result = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Never written." }],
      capture: captureOf(texts),
    });

    expect(word.word.writes()).toEqual([]);
    expect(result.snapshotOoxml).toBeNull();
    expect(result.outcomes[0].status).toBe("changed");
  });

  it("takes exactly ONE snapshot for a multi-edit batch", async () => {
    const result = await applyWordEdits({
      edits: [
        { paragraph: 1, text: "A." },
        { paragraph: 2, text: "B." },
        { paragraph: 3, text: "C." },
      ],
      capture: captureOf(texts),
    });

    expect(result.snapshotOoxml).toBe(
      JSON.stringify([
        {
          text: "Alpha.",
          uniqueLocalId: "id-1",
          styleBuiltIn: "Normal",
          outlineLevel: 10,
        },
        {
          text: "Bravo.",
          uniqueLocalId: "id-2",
          styleBuiltIn: "Normal",
          outlineLevel: 10,
        },
        {
          text: "Charlie.",
          uniqueLocalId: "id-3",
          styleBuiltIn: "Normal",
          outlineLevel: 10,
        },
        {
          text: "Delta.",
          uniqueLocalId: "id-4",
          styleBuiltIn: "Normal",
          outlineLevel: 10,
        },
      ]),
    );
  });

  it("rejects an ordinal beyond the sent window without reading the document", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 4, text: "Never seen." }],
      capture: captureOf(texts, 3),
    });

    expect(word.word.writes()).toEqual([]);
    expect(result.outcomes).toEqual([
      {
        index: 0,
        paragraph: 4,
        status: "unknown-ordinal",
        excerpt: "Never seen.",
      },
    ]);
  });

  it("reports every edit as failed when the run rejects, and writes nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    word.word.run.mockRejectedValueOnce(new Error("GeneralException"));

    const result = await applyWordEdits({
      edits: [{ paragraph: 1, text: "A." }],
      capture: captureOf(texts),
    });

    expect(result.hostFailed).toBe(true);
    expect(result.outcomes[0].status).toBe("failed");
    expect(bodyText()).toEqual(texts);
  });

  it("keeps the snapshot when the WRITE sync rejects mid-batch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Paragraph 2 sits in a locked content control. The batch is applied in
    // descending order, so paragraph 3 has already been rewritten when the
    // command for 2 is rejected: an Office.js batch is not a transaction.
    word.word.failWriteOn("id-2");

    const result = await applyWordEdits({
      edits: [
        { paragraph: 2, text: "Bravo, revised." },
        { paragraph: 3, text: "Charlie, revised." },
      ],
      capture: captureOf(texts),
    });

    expect(bodyText()[2]).toBe("Charlie, revised.");
    expect(result.hostFailed).toBe(true);
    // The document MOVED, so the snapshot is exactly what the user needs — it
    // is the only thing standing between a partial batch and no way back.
    expect(result.snapshotOoxml).not.toBeNull();
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "failed",
      "failed",
    ]);
    await expect(revertWordEdits(result.snapshotOoxml!)).resolves.toBe(true);
    expect(bodyText()).toEqual(texts);
  });

  it("keeps a verified-changed verdict when the write then rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    word.word.setParagraphs([
      { text: "Alpha." },
      { text: "Bravo, changed by the user." },
      { text: "Charlie." },
      { text: "Delta." },
    ]);
    word.word.failWriteOn("id-3");

    const result = await applyWordEdits({
      edits: [
        { paragraph: 2, text: "Never queued." },
        { paragraph: 3, text: "Queued and rejected." },
      ],
      capture: captureOf(texts),
    });

    // Edit 1 was never queued: the host's rejection says nothing about it, and
    // calling it "failed" would tell the user Word refused a change it never
    // saw.
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "changed",
      "failed",
    ]);
  });

  it("takes no snapshot when the READ sync rejects before any write", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    word.word.run.mockRejectedValueOnce(new Error("GeneralException"));

    const result = await applyWordEdits({
      edits: [{ paragraph: 1, text: "A." }],
      capture: captureOf(texts),
    });

    expect(result.snapshotOoxml).toBeNull();
    expect(bodyText()).toEqual(texts);
  });

  it("fails closed with no Word host at all", async () => {
    uninstallMockWordDocument();

    const result = await applyWordEdits({
      edits: [{ paragraph: 1, text: "A." }],
      capture: captureOf(texts),
    });

    expect(result.hostFailed).toBe(true);
    expect(result.snapshotOoxml).toBeNull();
    expect(result.outcomes[0].status).toBe("failed");
  });
});

describe("revertWordEdits", () => {
  let word: MockWordHost;

  beforeEach(() => {
    word = installMockWordDocument([{ text: "Alpha." }, { text: "Bravo." }]);
  });
  afterEach(() => {
    uninstallMockWordDocument();
    vi.restoreAllMocks();
  });

  it("restores the pre-batch body from the one snapshot", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 1, text: "Alpha, revised." }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });
    expect(word.word.paragraphs().map((entry) => entry.text)).toEqual([
      "Alpha, revised.",
      "Bravo.",
    ]);

    await expect(revertWordEdits(result.snapshotOoxml!)).resolves.toBe(true);
    expect(word.word.paragraphs().map((entry) => entry.text)).toEqual([
      "Alpha.",
      "Bravo.",
    ]);
  });

  it("reports failure rather than throwing when the host rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    word.word.run.mockRejectedValueOnce(new Error("nope"));
    await expect(revertWordEdits("[]")).resolves.toBe(false);
  });
});
