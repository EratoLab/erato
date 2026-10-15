import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import { buildWordDocumentArgs } from "../buildWordDocumentArgs";
import { readWordDocument } from "../readWordDocument";
import { applyWordEdits, revertWordEdits } from "../wordApplyEdits";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

const IDENTITY = "https://contoso.sharepoint.com/report.docx";

const captureOf = (
  texts: string[],
  paragraphsSent = texts.length,
  ids = true,
): WordDocumentCapture => ({
  identity: IDENTITY,
  ordinalMap: new Map(
    texts.map((text, index) => [
      index + 1,
      { uniqueLocalId: ids ? `id-${index + 1}` : null, text },
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

  it("reports each stage in order, and only checking when nothing is applicable", async () => {
    const stages: string[] = [];
    await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo, revised." }],
      capture: captureOf(texts),
      onStage: (stage) => stages.push(stage),
    });
    expect(stages).toEqual(["checking", "backup", "writing", "verifying"]);

    stages.length = 0;
    await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo, again." }],
      capture: captureOf(texts),
      onStage: (stage) => stages.push(stage),
    });
    expect(stages).toEqual(["checking"]);
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

    // Stable IDs make the resulting text order-independent; assert command order separately.
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
    expect(result.snapshotOoxml).not.toBeNull();
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "failed",
      "failed",
    ]);
    expect(result.afterFingerprint).toBeDefined();
    await expect(
      revertWordEdits(result.snapshotOoxml!, result.afterFingerprint),
    ).resolves.toBe("reverted");
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

describe("applyWordEdits without paragraph IDs", () => {
  let word: MockWordHost;
  const bodyText = () => word.word.paragraphs().map((entry) => entry.text);
  const withoutIds = (texts: string[]) => captureOf(texts, texts.length, false);

  beforeEach(() => {
    word = installMockWordDocument();
    word.word.hideParagraphIds(true);
  });
  afterEach(() => {
    uninstallMockWordDocument();
    vi.restoreAllMocks();
  });

  it("locates paragraphs by text after one was added above", async () => {
    const texts = ["Alpha.", "Bravo.", "Charlie."];
    word.word.setParagraphs([
      { text: "Added." },
      ...texts.map((text) => ({ text })),
    ]);

    const result = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Bravo, revised." }],
      capture: withoutIds(texts),
    });

    expect(result.outcomes[0].status).toBe("applied");
    expect(bodyText()).toEqual([
      "Added.",
      "Alpha.",
      "Bravo, revised.",
      "Charlie.",
    ]);
  });

  it("skips repeats it cannot tell apart and still applies the rest", async () => {
    const texts = [...Array.from({ length: 8 }, () => "Repeated."), "Unique."];
    word.word.setParagraphs(texts.map((text) => ({ text })));

    const result = await applyWordEdits({
      edits: [
        { paragraph: 4, text: "Never written." },
        { paragraph: 9, text: "Unique, revised." },
      ],
      capture: withoutIds(texts),
    });

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "ambiguous",
      "applied",
    ]);
    expect(bodyText()).toEqual([...texts.slice(0, 8), "Unique, revised."]);
  });

  it("refuses when a repeat existed at capture and the original was then deleted", async () => {
    word.word.setParagraphs(
      ["P.", "N.", "Q.", "Same.", "R."].map((text) => ({ text })),
    );

    const result = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Never written." }],
      capture: withoutIds(["P.", "Same.", "N.", "Q.", "Same.", "R."]),
    });

    expect(result.outcomes[0].status).toBe("ambiguous");
    expect(word.word.writes()).toEqual([]);
  });
});

describe("applyWordEdits with paragraph IDs", () => {
  afterEach(uninstallMockWordDocument);

  it("never writes a copy in place of an edited original", async () => {
    const word = installMockWordDocument([
      { text: "Alpha.", uniqueLocalId: "id-1" },
      { text: "Bravo, amended.", uniqueLocalId: "id-2" },
      { text: "Bravo.", uniqueLocalId: "copy" },
      { text: "Charlie.", uniqueLocalId: "id-3" },
    ]);

    const result = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Never written." }],
      capture: captureOf(["Alpha.", "Bravo.", "Charlie."]),
    });

    expect(result.outcomes[0].status).toBe("changed");
    expect(word.word.writes()).toEqual([]);
  });
});

describe("applyWordEdits on paragraphs with pending revisions", () => {
  let word: MockWordHost;
  const texts = ["Alpha.", "Bravo.", "Charlie.", "Delta."];
  const revision = (author: string) =>
    `<w:del w:id="1" w:author="${author}" w:date="2026-10-12T09:30:00Z"><w:r><w:delText>30</w:delText></w:r></w:del>`;

  beforeEach(() => {
    word = installMockWordDocument([
      { text: "Alpha." },
      { text: "Bravo.", ooxml: revision("RA Dr. Weber") },
      { text: "Charlie." },
      { text: "Delta.", ooxml: revision("Kanzlei Schmidt") },
    ]);
  });
  afterEach(() => {
    uninstallMockWordDocument();
    vi.restoreAllMocks();
  });

  it("refuses a revised paragraph, names its author and still applies a clean one", async () => {
    const result = await applyWordEdits({
      edits: [
        { paragraph: 1, text: "Alpha, revised." },
        { paragraph: 2, text: "Bravo, revised." },
      ],
      capture: captureOf(texts),
    });

    expect(result.outcomes).toEqual([
      {
        index: 0,
        paragraph: 1,
        status: "applied",
        excerpt: "Alpha, revised.",
      },
      {
        index: 1,
        paragraph: 2,
        status: "revisions",
        excerpt: "Bravo, revised.",
        authors: ["RA Dr. Weber"],
      },
    ]);
    expect(word.word.paragraphs().map((p) => p.text)).toEqual([
      "Alpha, revised.",
      "Bravo.",
      "Charlie.",
      "Delta.",
    ]);
  });

  it("refuses a span when any paragraph in it holds a revision, before writing anything", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 1, through: 2, text: "Alpha and Bravo." }],
      capture: captureOf(texts),
    });

    expect(result.outcomes[0]).toMatchObject({
      status: "revisions",
      authors: ["RA Dr. Weber"],
    });
    expect(word.word.writes()).toEqual([]);
    expect(result.snapshotOoxml).toBeNull();
  });

  it("refuses every edit while Track Changes is on, naming authors where there are revisions", async () => {
    word.word.setTrackingMode("TrackAll");
    const result = await applyWordEdits({
      edits: [
        { paragraph: 3, text: "Charlie, revised." },
        { paragraph: 4, text: "Delta, revised." },
      ],
      capture: captureOf(texts),
    });

    expect(
      result.outcomes.map(({ status, authors }) => ({ status, authors })),
    ).toEqual([
      { status: "tracking", authors: undefined },
      { status: "revisions", authors: ["Kanzlei Schmidt"] },
    ]);
    expect(word.word.writes()).toEqual([]);
  });

  it("refuses a capture read under Track Changes even once it is off", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 3, text: "Charlie, revised." }],
      capture: { ...captureOf(texts), trackChanges: true },
    });

    expect(result.outcomes[0].status).toBe("tracking");
    expect(word.word.writes()).toEqual([]);
  });

  it("writes nothing when a paragraph's revisions cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    word.word.setParagraphs([
      { text: "Alpha." },
      { text: "Bravo.", ooxml: "<w:ins" },
    ]);
    const result = await applyWordEdits({
      edits: [
        { paragraph: 1, text: "Alpha, revised." },
        { paragraph: 2, text: "Bravo, revised." },
      ],
      capture: captureOf(["Alpha.", "Bravo."]),
    });

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "failed",
      "failed",
    ]);
    expect(word.word.writes()).toEqual([]);
  });
});

describe("applyWordEdits on a Word package with another author's revisions", () => {
  const BY = 'w:author="RA Dr. Weber" w:date="2026-10-12T09:30:00Z"';
  const xml = packageXml(
    [
      "<w:p><w:r><w:t>Clean clause.</w:t></w:r></w:p>",
      `<w:p><w:r><w:t xml:space="preserve">Payment within </w:t></w:r><w:del w:id="1" ${BY}><w:r><w:delText>30</w:delText></w:r></w:del><w:ins w:id="2" ${BY}><w:r><w:t>60</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:rPr><w:ins w:id="3" ${BY}/></w:rPr></w:pPr><w:ins w:id="4" ${BY}><w:r><w:t>Inserted clause.</w:t></w:r></w:ins></w:p>`,
    ].join(""),
  );
  const revisions = (ooxml: string) =>
    ooxml.match(/<w:(?:ins|del) [^>]*>|<w:delText>[^<]*/g);

  it.each(["Off", "TrackAll"])(
    "leaves them exactly as they were with Track Changes %s",
    async (mode) => {
      const host = installWordOoxmlHost(xml, {
        profile: "word-pc-16.0.20326",
        trackChanges: true,
      });
      host.setTrackingMode(mode);
      const read = await readWordDocument();
      if (!read.ok) throw new Error("read failed");
      const build = buildWordDocumentArgs(read.paragraphs);
      const before = revisions(host.ooxml());

      const result = await applyWordEdits({
        edits: [
          { paragraph: 1, text: "Clean clause, revised." },
          { paragraph: 2, text: "Payment within 45 days." },
          { paragraph: 3, text: "Inserted clause, revised." },
        ],
        capture: {
          identity: IDENTITY,
          ordinalMap: build.ordinalMap,
          paragraphsSent: build.coverage.paragraphsSent,
          renderedOrdinals: build.renderedOrdinals,
          partialOrdinal: build.partialOrdinal,
        },
      });

      expect(result.outcomes.map(({ status }) => status)).toEqual([
        mode === "Off" ? "applied" : "tracking",
        "revisions",
        "revisions",
      ]);
      expect(result.outcomes[1].authors).toEqual(["RA Dr. Weber"]);
      expect(revisions(host.ooxml())).toEqual(before);
      expect(host.ooxml().includes("Clean clause, revised.")).toBe(
        mode === "Off",
      );
    },
  );

  it.each([
    ["Word PC", { profile: "word-pc-16.0.20326" as const }],
    [
      "Word for the web, whose paragraph OOXML leaves them out",
      { profile: "word-web" as const, paragraphOoxmlOmitsProperties: true },
    ],
  ])(
    "refuses a revised paragraph mark or paragraph format on %s",
    async (_host, options) => {
      const host = installWordOoxmlHost(
        packageXml(
          [
            "<w:p><w:r><w:t>Clean clause.</w:t></w:r></w:p>",
            `<w:p><w:pPr><w:rPr><w:ins w:id="5" ${BY}/></w:rPr></w:pPr><w:r><w:t>Split clause,</w:t></w:r></w:p>`,
            "<w:p><w:r><w:t>continued here.</w:t></w:r></w:p>",
            `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="6" w:author="Kanzlei Schmidt" w:date="2026-10-13T08:15:00Z"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>Centred clause.</w:t></w:r></w:p>`,
          ].join(""),
        ),
        options,
      );
      const read = await readWordDocument();
      if (!read.ok) throw new Error("read failed");
      const build = buildWordDocumentArgs(read.paragraphs);

      const result = await applyWordEdits({
        edits: [
          { paragraph: 1, text: "Clean clause, revised." },
          { paragraph: 2, text: "Split clause, revised," },
          { paragraph: 4, text: "Centred clause, revised." },
        ],
        capture: {
          identity: IDENTITY,
          ordinalMap: build.ordinalMap,
          paragraphsSent: build.coverage.paragraphsSent,
          renderedOrdinals: build.renderedOrdinals,
          partialOrdinal: build.partialOrdinal,
        },
      });

      expect(
        result.outcomes.map(({ status, authors }) => ({ status, authors })),
      ).toEqual([
        { status: "applied", authors: undefined },
        { status: "revisions", authors: ["RA Dr. Weber"] },
        { status: "revisions", authors: ["Kanzlei Schmidt"] },
      ]);
      expect(host.ooxml()).toContain("<w:pPrChange");
      expect(host.ooxml()).not.toContain("revised,");
    },
  );
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

    await expect(
      revertWordEdits(result.snapshotOoxml!, result.afterFingerprint),
    ).resolves.toBe("reverted");
    expect(word.word.paragraphs().map((entry) => entry.text)).toEqual([
      "Alpha.",
      "Bravo.",
    ]);
  });

  it("refuses after a later edit and leaves the body untouched", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 1, text: "Alpha, revised." }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });
    word.word.setParagraphs([
      { text: "Alpha, revised." },
      { text: "Bravo, typed later." },
    ]);

    await expect(
      revertWordEdits(result.snapshotOoxml!, result.afterFingerprint),
    ).resolves.toBe("stale");
    expect(word.word.writes()).toEqual([]);
    expect(word.word.paragraphs().map((entry) => entry.text)).toEqual([
      "Alpha, revised.",
      "Bravo, typed later.",
    ]);
  });

  it("refuses while Track Changes is on, and without a recorded post-write body", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 1, text: "Alpha, revised." }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });
    word.word.setTrackingMode("TrackAll");
    await expect(
      revertWordEdits(result.snapshotOoxml!, result.afterFingerprint),
    ).resolves.toBe("tracking");
    word.word.setTrackingMode("Off");
    await expect(
      revertWordEdits(result.snapshotOoxml!, undefined),
    ).resolves.toBe("stale");
    expect(word.word.paragraphs()[0].text).toBe("Alpha, revised.");
  });

  it("reports failure rather than throwing when the host rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    word.word.run.mockRejectedValueOnce(new Error("nope"));
    await expect(revertWordEdits("[]", "raw:[]")).resolves.toBe("failed");
  });

  it("logs Office errors without the message, which can quote the document", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const officeError = () =>
      Object.assign(
        new Error("Cannot edit 'SENTINEL-PRIVATE-TEXT' in this paragraph."),
        { name: "RichApi.Error", code: "GeneralException" },
      );
    word.word.run.mockRejectedValueOnce(officeError());
    await applyWordEdits({
      edits: [{ paragraph: 1, text: "A." }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });
    const result = await applyWordEdits({
      edits: [{ paragraph: 1, text: "Alpha, revised." }],
      capture: captureOf(["Alpha.", "Bravo."]),
    });
    word.word.run.mockRejectedValueOnce(officeError());
    await revertWordEdits(result.snapshotOoxml!, result.afterFingerprint);

    expect(warn).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("RichApi.Error");
    expect(logged).not.toContain("SENTINEL-PRIVATE-TEXT");
  });
});
