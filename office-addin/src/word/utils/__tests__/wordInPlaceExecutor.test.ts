import { afterEach, describe, expect, it, vi } from "vitest";

import {
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
} from "../../../test/mocks/word/realisticWordFixtures";
import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import {
  decodeWordDocumentBackup,
  decodeWordInPlaceBackup,
} from "../wordDocumentPackage";
import {
  captureWordAuthoringSnapshot,
  wordDocumentFingerprint,
} from "../wordDocumentXml";
import {
  resetWordInPlaceLatchForTests,
  wordInPlaceAvailability,
} from "../wordInPlaceSwitch";
import { predictWordBodyParagraphs } from "../wordLiveParagraphs";
import { expandWordTableCellSubmission } from "../wordTableCellSubmission";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type {
  WordDocumentApplyResult,
  WordDocumentRevertResult,
} from "../wordApplyDocumentPlan";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanEntry,
} from "../wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CLOSING = "Closing paragraph.";
const STATUS = "Status:";
const QUESTIONS = "Open questions follow.";
const SCHEDULE = "Schedule the pilot";

/** The realistic SharePoint-style document, with an en-GB run in the closing paragraph. */
function inPlaceFixture(edit: (doc: Document) => void = () => {}): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const closing = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
      (t) => t.textContent === CLOSING,
    )!.parentElement!;
    const props = doc.createElementNS(W, "w:rPr");
    const lang = doc.createElementNS(W, "w:lang");
    lang.setAttributeNS(W, "w:val", "en-GB");
    props.append(lang);
    closing.prepend(props);
    edit(doc);
  });
}

function install(options: WordOoxmlHostOptions = {}, xml = inPlaceFixture()) {
  return installWordOoxmlHost(xml, {
    profile: "word-pc-16.0.20326",
    ...options,
  });
}

const block = (snapshot: WordAuthoringSnapshot, prefix: string) =>
  snapshot.blocks.find((b) => b.text.startsWith(prefix))!;

function rewrite(
  snapshot: WordAuthoringSnapshot,
  changes: [prefix: string, block: Partial<WordPlanBlock>][],
): WordDocumentPlan {
  const replaced = new Map(
    changes.map(([prefix, change], i) => {
      const source = block(snapshot, prefix);
      return [
        source.ref,
        {
          id: `new-${i}`,
          type: source.type,
          ...(source.level === undefined ? {} : { level: source.level }),
          ...(source.list
            ? { list: source.list, ordered: source.ordered }
            : {}),
          ...(source.styleRef && source.type !== "heading"
            ? { styleRef: source.styleRef }
            : {}),
          ...change,
        } as WordPlanBlock,
      ];
    }),
  );
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    deleted: [],
    entries: snapshot.blocks.map(
      (b): WordPlanEntry =>
        replaced.has(b.ref)
          ? { kind: "replace", source: [b.ref], blocks: [replaced.get(b.ref)!] }
          : { kind: "keep", source: [b.ref] },
    ),
  };
}

const apply = (
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  onBeforeWrite?: (before: string) => void,
) =>
  applyWordDocumentPlan(
    JSON.stringify(plan),
    snapshot,
    snapshot.ownerMessageId,
    onBeforeWrite,
  );
const report = (
  result: WordDocumentApplyResult | WordDocumentRevertResult,
  operation = "apply",
) => renderWordDiagnosticReport(operation, result.status, result.diagnostic);
const paragraphIndex = (ooxml: string, text: string) =>
  predictWordBodyParagraphs(ooxml).findIndex((p) => p.text === text);
const typed = (ooxml: string) =>
  captureWordAuthoringSnapshot(ooxml, "doc-A", "Off", true, "verify");
const paragraphXml = (ooxml: string, text: string) => {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  return new XMLSerializer().serializeToString(
    Array.from(doc.getElementsByTagNameNS(W, "p")).find((p) =>
      p.textContent?.startsWith(text),
    )!,
  );
};
const mutations = (events: string[]) =>
  events.filter((e) => e.startsWith("mutation:"));

afterEach(() => {
  resetWordInPlaceLatchForTests();
  delete window.WORD_FORCE_IMPORT_APPLY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("in-place apply", { timeout: 30_000 }, () => {
  it("rewrites a paragraph with b/i/u, a list item and a language-tagged paragraph without importing", async () => {
    const host = install();
    const original = host.get();
    const snapshot = await captureRealisticSnapshot();
    const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
    host.events.length = 0;
    const save = vi.fn((_before: string) => {
      host.events.push("backup-saved");
    });
    const result = await apply(
      rewrite(snapshot, [
        [
          STATUS,
          {
            text: "Status: on track and funded.",
            runs: [
              { text: "Status: ", bold: true },
              { text: "on track", italic: true, underline: true },
              { text: " and funded." },
            ],
          },
        ],
        [SCHEDULE, { text: "Schedule the pilot for October." }],
        [
          CLOSING,
          {
            text: "Closing remarks.",
            runs: [{ text: "Closing remarks.", language: "en-GB" }],
          },
        ],
      ]),
      snapshot,
      save,
    );
    expect(result.status, report(result)).toBe("applied");
    expect(result.outcome).toEqual({
      route: "in-place",
      tier: "block",
      adjustments: [],
      ops: 3,
    });
    expect(save).toHaveBeenCalledOnce();
    const capture = host.events.indexOf("capture-file");
    const saved = host.events.indexOf("backup-saved");
    const firstWrite = host.events.findIndex((e) => e.startsWith("mutation:"));
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(saved).toBeGreaterThan(capture);
    expect(firstWrite).toBeGreaterThan(saved);
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(original);
    expect(decodeWordDocumentBackup(save.mock.calls[0][0]).bytes).toEqual(
      original,
    );
    expect(host.insert).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
    expect(result.afterFingerprint).toMatch(/^word-scope-v1:/);

    const after = typed(host.ooxml());
    expect(
      block(after, "Status").runs?.map((r) => [
        r.text,
        !!r.bold,
        !!r.italic,
        !!r.underline,
      ]),
    ).toEqual([
      ["Status: ", true, false, false],
      ["on track", false, true, true],
      [" and funded.", false, false, false],
    ]);
    const schedule = block(after, SCHEDULE);
    expect(schedule).toMatchObject({
      type: "list-item",
      list: "existing-1",
      styleRef: "ListParagraph",
    });
    expect(paragraphXml(host.ooxml(), SCHEDULE)).toMatch(
      /<w:pStyle w:val="ListParagraph"\/><w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr>/,
    );
    expect(block(after, "Closing").runs).toEqual([
      { text: "Closing remarks.", language: "en-GB" },
    ]);
    expect(paragraphXml(host.ooxml(), "Closing")).toContain(
      '<w:lang w:val="en-GB"/>',
    );
    expect(after.blocks.map((b) => b.text)).toEqual(
      snapshot.blocks.map((b) =>
        b.text.startsWith(STATUS)
          ? "Status: on track and funded."
          : b.text.startsWith(SCHEDULE)
            ? "Schedule the pilot for October."
            : b.text === CLOSING
              ? "Closing remarks."
              : b.text,
      ),
    );
  });

  it("edits one table cell in place", async () => {
    const host = install();
    const original = host.get();
    const snapshot = await captureRealisticSnapshot();
    const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
    host.events.length = 0;
    const save = vi.fn((_before: string) => {
      host.events.push("backup-saved");
    });
    const table = snapshot.blocks.find((b) => b.nativeKind === "table")!;
    const plan = expandWordTableCellSubmission(
      {
        snapshot: snapshot.token,
        readToken: "read-proof",
        table_cell: {
          sourceRef: table.ref,
          rowIndex: 1,
          cellIndex: 1,
          expectedText: "42",
          text: "43",
        },
      },
      snapshot,
    );
    const result = await apply(plan, snapshot, save);
    expect(result.status, report(result)).toBe("applied");
    expect(result.outcome).toEqual({
      route: "in-place",
      tier: "block",
      adjustments: [],
      ops: 1,
    });
    expect(host.events.indexOf("backup-saved")).toBeGreaterThan(
      host.events.indexOf("capture-file"),
    );
    expect(mutations(host.events)).toEqual(["mutation:insertText"]);
    expect(host.events.indexOf("mutation:insertText")).toBeGreaterThan(
      host.events.indexOf("backup-saved"),
    );
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(original);
    expect(host.insert).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
    expect(
      typed(host.ooxml())
        .blocks.find((b) => b.nativeKind === "table")!
        .content!.rows.map((r) => r.cells.map((c) => c.text)),
    ).toEqual([
      ["Region", "Budget"],
      ["North", "43"],
    ]);
  });

  it("reverts an in-place write to the exact original package", async () => {
    const host = install();
    const original = wordDocumentFingerprint(host.ooxml());
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      rewrite(snapshot, [
        [
          STATUS,
          {
            text: "Bold new status.",
            runs: [{ text: "Bold", bold: true }, { text: " new status." }],
          },
        ],
        [
          CLOSING,
          { text: "Bye.", runs: [{ text: "Bye.", language: "en-GB" }] },
        ],
      ]),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(wordDocumentFingerprint(host.ooxml())).not.toBe(original);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(reverted.outcome).toMatchObject({
      route: "in-place",
      tier: "block",
    });
    expect(wordDocumentFingerprint(host.ooxml())).toBe(original);
    expect(host.insert).not.toHaveBeenCalled();
  });

  it("still undoes an in-place write in place after the kill switch was turned on", async () => {
    const host = install();
    const original = wordDocumentFingerprint(host.ooxml());
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: rewritten." }]]),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    window.WORD_FORCE_IMPORT_APPLY = true;
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(reverted.outcome?.route).toBe("in-place");
    expect(host.insert).not.toHaveBeenCalled();
    expect(wordDocumentFingerprint(host.ooxml())).toBe(original);
  });

  it("applies a plan without changes as a no-op", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    host.events.length = 0;
    const save = vi.fn();
    const result = await apply(rewrite(snapshot, []), snapshot, save);
    expect(result).toEqual({
      status: "applied",
      outcome: { route: "in-place", tier: "block", adjustments: [], ops: 0 },
    });
    expect(save).not.toHaveBeenCalled();
    expect(host.events).toEqual([]);
    expect(snapshot.used).toBe(true);
  });
});

describe("in-place routing", { timeout: 30_000 }, () => {
  it("sends the same plan to the import while the kill switch is on", async () => {
    window.WORD_FORCE_IMPORT_APPLY = true;
    const host = install({ profile: "word-web" });
    const snapshot = await captureRealisticSnapshot();
    const result = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: imported." }]]),
      snapshot,
    );
    expect(result.status, report(result)).toBe("applied");
    expect(result.outcome?.route).toBe("import");
    expect(host.insert).toHaveBeenCalledOnce();
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "disabled",
    });
  });

  it("latches the session to the import after Word writes something unexpected", async () => {
    const host = install({ replaceDropsRunProperties: true });
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    const result = await apply(
      rewrite(snapshot, [
        [
          CLOSING,
          { text: "Bye.", runs: [{ text: "Bye.", language: "en-GB" }] },
        ],
      ]),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "verify",
      reason: "output-mismatch",
      details: { route: "in-place", verifyTier: "block" },
    });
    const closing = snapshot.blocks.findIndex((b) => b.text === CLOSING) + 1;
    expect(result.diagnostic?.details?.locations).toEqual([
      `/word/document.xml body block ${closing}: runs`,
    ]);
    expect(report(result)).toContain("Route: in-place");
    expect(result.before).toBeTruthy();
    expect(result.afterFingerprint).toBe(wordDocumentFingerprint(host.ooxml()));
    const record = decodeWordInPlaceBackup(result.before!).inPlace!;
    expect(record.scopedFallback).toBe(true);
    expect(record.mismatched).toEqual([0]);
    expect(host.paragraphIds()).toContain(record.ops[0].id);
    expect(report(result)).not.toContain(record.ops[0].id!);
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "latched",
    });

    const next = await captureRealisticSnapshot("message-B");
    const imported = await apply(
      rewrite(next, [[STATUS, { text: "Status: imported." }]]),
      next,
    );
    expect(imported.status, report(imported)).toBe("applied");
    expect(imported.outcome?.route).toBe("import");
    expect(host.insert).toHaveBeenCalledOnce();
    expect(debug).toHaveBeenLastCalledWith(
      "[erato] Word apply timings (ms)",
      expect.objectContaining({ route: "import", routeReason: "latched" }),
    );

    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("stale");
  });

  it("falls back to the import before saving anything when body.paragraphs differs from the package", async () => {
    const xml = inPlaceFixture((doc) => {
      const body = doc.getElementsByTagNameNS(W, "body")[0];
      const holder = new DOMParser().parseFromString(
        `<w:p xmlns:w="${W}"><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`,
        "application/xml",
      ).documentElement;
      body.insertBefore(doc.importNode(holder, true), body.firstChild);
    });
    const host = install(
      { profile: "word-web", includeTextBoxParagraphs: true },
      xml,
    );
    const snapshot = await captureRealisticSnapshot();
    expect(snapshot.issue).toBeUndefined();
    const save = vi.fn();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const result = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: imported." }]]),
      snapshot,
      save,
    );
    expect(result.status, report(result)).toBe("applied");
    expect(result.outcome?.route).toBe("import");
    expect(save).toHaveBeenCalledOnce();
    expect(host.insert).toHaveBeenCalledOnce();
    expect(mutations(host.events)).toEqual([]);
    expect(debug).toHaveBeenLastCalledWith(
      "[erato] Word apply timings (ms)",
      expect.objectContaining({ route: "import", routeReason: "alignment" }),
    );
    expect(wordInPlaceAvailability()).toEqual({ enabled: true });
  });
});

describe("in-place failure and recovery", { timeout: 30_000 }, () => {
  it("stops without writing when a paragraph changes between the two paragraph reads", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const index = paragraphIndex(host.ooxml(), QUESTIONS);
    host.editParagraph(index, "Questions changed meanwhile.", "after-capture");
    const save = vi.fn();
    const result = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: changed." }]]),
      snapshot,
      save,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "source-changed",
      details: { route: "in-place" },
    });
    expect(save).not.toHaveBeenCalled();
    expect(mutations(host.events)).toEqual([]);
    expect(host.insert).not.toHaveBeenCalled();
    expect(snapshot.used).toBe(false);
  });

  it("stops without writing when the document changed between the first paragraph read and the backup", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.editParagraph(
      paragraphIndex(host.ooxml(), QUESTIONS),
      "Questions changed.",
      { afterSync: 1 },
    );
    const save = vi.fn();
    const result = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: changed." }]]),
      snapshot,
      save,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "source-changed",
      details: { route: "in-place", paragraphs: expect.any(Object) },
    });
    expect(save).not.toHaveBeenCalled();
    expect(mutations(host.events)).toEqual([]);
  });

  it("reports a batch Word rejected midway by change and reverts the written part exactly", async () => {
    const host = install();
    const original = wordDocumentFingerprint(host.ooxml());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.failAtCommand(2);
    const result = await apply(
      rewrite(snapshot, [
        [STATUS, { text: "Status: never written." }],
        [
          CLOSING,
          { text: "Bye.", runs: [{ text: "Bye.", language: "en-GB" }] },
        ],
      ]),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "write",
      reason: "host-error",
      officeCode: "GeneralException",
      details: { route: "in-place", partial: { applied: 1, untouched: 1 } },
    });
    expect(report(result)).toContain("Partly written: 1 changed, 1 untouched");
    expect(result.afterFingerprint).toMatch(/^word-scope-v1:/);
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "latched",
    });
    const written = Object.fromEntries(
      decodeWordInPlaceBackup(result.before!).inPlace!.ops.map((op) => [
        snapshot.blocks.find((b) => b.ref === op.ref)!.text.slice(0, 6),
        op.afterSignature !== op.originalSignature,
      ]),
    );
    expect(written).toEqual({ Status: false, Closin: true });
    expect(host.ooxml()).toContain("Bye.");
    expect(host.ooxml()).toContain("the pilot is on track.");

    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(wordDocumentFingerprint(host.ooxml())).toBe(original);
  });

  it("counts a region Word left half written per change", async () => {
    const host = install();
    const original = wordDocumentFingerprint(host.ooxml());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    // Adjacent list items form one region, written last to first: the second write is rejected.
    host.failAtCommand(2);
    const result = await apply(
      rewrite(snapshot, [
        ["Confirm the regions", { text: "Confirm every region." }],
        [SCHEDULE, { text: "Schedule the pilot for October." }],
      ]),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic?.details?.partial).toEqual({
      applied: 1,
      untouched: 1,
    });
    expect(host.ooxml()).toContain("Schedule the pilot for October.");
    expect(host.ooxml()).toContain("Confirm the regions.");

    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(wordDocumentFingerprint(host.ooxml())).toBe(original);
  });

  it("reverts around a later edit to another paragraph and keeps that edit", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: rewritten." }]]),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    host.editParagraph(
      paragraphIndex(host.ooxml(), QUESTIONS),
      "The user kept working here.",
    );
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    const after = typed(host.ooxml());
    expect(after.blocks.map((b) => b.text)).toEqual(
      snapshot.blocks.map((b) =>
        b.text === QUESTIONS ? "The user kept working here." : b.text,
      ),
    );
  });

  it("refuses to revert over a later edit to a written paragraph", async () => {
    const host = install();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: rewritten." }]]),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    host.editParagraph(
      paragraphIndex(host.ooxml(), "Status: rewritten."),
      "Status: the user's own words.",
    );
    host.events.length = 0;
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status).toBe("stale");
    const status = snapshot.blocks.findIndex((b) => b.text.startsWith(STATUS));
    expect(reverted.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "source-changed",
      details: {
        route: "in-place",
        locations: [`/word/document.xml body block ${status + 1}: changed`],
      },
    });
    expect(mutations(host.events)).toEqual([]);
    expect(host.ooxml()).toContain("Status: the user's own words.");
  });
});

const closingRewrite = (snapshot: WordAuthoringSnapshot) =>
  rewrite(snapshot, [
    [CLOSING, { text: "Bye.", runs: [{ text: "Bye.", language: "en-GB" }] }],
  ]);

describe("in-place routing to the import", { timeout: 30_000 }, () => {
  it("imports when Word reports cell paragraph text differently from the package", async () => {
    const host = install({ cellParagraphTextSuffix: "\u0007" });
    const snapshot = await captureRealisticSnapshot();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const save = vi.fn();
    const table = snapshot.blocks.find((b) => b.nativeKind === "table")!;
    const plan = expandWordTableCellSubmission(
      {
        snapshot: snapshot.token,
        readToken: "read-proof",
        table_cell: {
          sourceRef: table.ref,
          rowIndex: 1,
          cellIndex: 1,
          expectedText: "42",
          text: "43",
        },
      },
      snapshot,
    );
    const result = await apply(plan, snapshot, save);
    expect(result.status, report(result)).toBe("applied");
    expect(result.outcome?.route).toBe("import");
    expect(save).toHaveBeenCalledOnce();
    expect(host.insert).toHaveBeenCalledOnce();
    expect(mutations(host.events)).toEqual([]);
    expect(debug).toHaveBeenLastCalledWith(
      "[erato] Word apply timings (ms)",
      expect.objectContaining({ route: "import", routeReason: "alignment" }),
    );
    expect(wordInPlaceAvailability()).toEqual({ enabled: true });
  });

  it("imports and latches when a read only the in-place route makes fails", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    host.failParagraphOoxml();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const save = vi.fn();
    const result = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: imported." }]]),
      snapshot,
      save,
    );
    expect(result.status, report(result)).toBe("applied");
    expect(result.outcome?.route).toBe("import");
    expect(save).toHaveBeenCalledOnce();
    expect(host.insert).toHaveBeenCalledOnce();
    expect(mutations(host.events)).toEqual([]);
    expect(debug).toHaveBeenLastCalledWith(
      "[erato] Word apply timings (ms)",
      expect.objectContaining({ route: "import", routeReason: "host-error" }),
    );
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "latched",
    });
  });

  it("imports on a host without WordApi 1.6", async () => {
    const host = install({
      isSetSupported: (name, version) =>
        !(name === "WordApi" && version === "1.6"),
    });
    const snapshot = await captureRealisticSnapshot();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const result = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: imported." }]]),
      snapshot,
    );
    expect(result.status, report(result)).toBe("applied");
    expect(result.outcome?.route).toBe("import");
    expect(host.insert).toHaveBeenCalledOnce();
    expect(mutations(host.events)).toEqual([]);
    expect(debug).toHaveBeenLastCalledWith(
      "[erato] Word apply timings (ms)",
      expect.objectContaining({ route: "import", routeReason: "host-sets" }),
    );
  });

  it("is unavailable without the document package", () => {
    install({
      isSetSupported: (name, version) =>
        !(name === "WordApi" && version === "1.7"),
    });
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "no-package",
    });
  });
});

describe("in-place writes under Track Changes", { timeout: 30_000 }, () => {
  it("never writes in place while Track Changes is on", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
    host.setTrackingMode("TrackAll");
    host.events.length = 0;
    const save = vi.fn();
    const result = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: tracked." }]]),
      snapshot,
      save,
    );
    expect(result.status).toBe("stale");
    expect(result.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "tracking",
      details: { route: "in-place" },
    });
    expect(save).not.toHaveBeenCalled();
    expect(mutations(host.events)).toEqual([]);
    expect(host.insert).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
    expect(snapshot.used).toBe(false);
  });

  it("never reverts in place while Track Changes is on", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const applied = await apply(
      rewrite(snapshot, [[STATUS, { text: "Status: rewritten." }]]),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
    host.setTrackingMode("TrackAll");
    host.events.length = 0;
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status).toBe("stale");
    expect(reverted.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "tracking",
      details: { route: "in-place" },
    });
    expect(mutations(host.events)).toEqual([]);
    expect(setter).not.toHaveBeenCalled();
    expect(host.ooxml()).toContain("Status: rewritten.");
  });
});

describe(
  "restore after an unverified in-place write",
  { timeout: 30_000 },
  () => {
    it("restores the exact original package after Word dropped run properties", async () => {
      const host = install({
        profile: "word-web",
        replaceDropsRunProperties: true,
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const original = wordDocumentFingerprint(host.ooxml());
      const snapshot = await captureRealisticSnapshot();
      const applied = await apply(closingRewrite(snapshot), snapshot);
      expect(applied.status).toBe("interrupted");
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(reverted.outcome?.route).toBe("import");
      expect(host.insert).toHaveBeenCalledOnce();
      expect(wordDocumentFingerprint(host.ooxml())).toBe(original);
    });

    it("undoes only the written paragraphs when a later edit elsewhere blocks the exact restore", async () => {
      const boldStatus = inPlaceFixture((doc) => {
        const run = Array.from(doc.getElementsByTagNameNS(W, "t")).find((t) =>
          t.textContent?.startsWith(STATUS),
        )!.parentElement!;
        const props = doc.createElementNS(W, "w:rPr");
        props.append(
          doc.createElementNS(W, "w:b"),
          doc.createElementNS(W, "w:bCs"),
        );
        run.prepend(props);
      });
      const host = install({ replaceDropsRunProperties: true }, boldStatus);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const original = paragraphXml(host.ooxml(), STATUS);
      const snapshot = await captureRealisticSnapshot();
      const applied = await apply(
        rewrite(snapshot, [
          [
            STATUS,
            {
              text: "Status: rewritten.",
              runs: [{ text: "Status: rewritten.", bold: true }],
            },
          ],
        ]),
        snapshot,
      );
      expect(applied.status).toBe("interrupted");
      expect(
        decodeWordInPlaceBackup(applied.before!).inPlace?.scopedFallback,
      ).toBe(true);
      host.editParagraph(
        paragraphIndex(host.ooxml(), QUESTIONS),
        "The user kept working here.",
      );
      host.setReplaceFault(undefined);
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(reverted.outcome?.route).toBe("in-place");
      expect(host.insert).not.toHaveBeenCalled();
      expect(typed(host.ooxml()).blocks.map((b) => b.text)).toEqual(
        snapshot.blocks.map((b) =>
          b.text === QUESTIONS ? "The user kept working here." : b.text,
        ),
      );
      expect(paragraphXml(host.ooxml(), STATUS)).toBe(original);
    });

    it("never reports a Restore that repeats Word's mistake as reverted", async () => {
      const host = install({ replaceDropsRunProperties: true });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      const applied = await apply(closingRewrite(snapshot), snapshot);
      expect(applied.status).toBe("interrupted");
      host.editParagraph(
        paragraphIndex(host.ooxml(), QUESTIONS),
        "The user kept working here.",
      );
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status).toBe("interrupted");
      expect(reverted.afterFingerprint).toBeUndefined();
      const closing = snapshot.blocks.findIndex((b) => b.text === CLOSING) + 1;
      expect(reverted.diagnostic).toMatchObject({
        stage: "restore",
        reason: "output-mismatch",
        details: {
          route: "in-place",
          locations: [`/word/document.xml body block ${closing}: signature`],
        },
      });
      expect(host.ooxml()).toContain("The user kept working here.");
      expect(host.insert).not.toHaveBeenCalled();
    });

    it("restores the exact package after Word changed a paragraph it was not asked to", async () => {
      const host = install({ profile: "word-web" });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const original = wordDocumentFingerprint(host.ooxml());
      const snapshot = await captureRealisticSnapshot();
      host.setReplaceFault("edits-next");
      const applied = await apply(
        rewrite(snapshot, [[STATUS, { text: "Status: rewritten." }]]),
        snapshot,
      );
      expect(applied.status).toBe("interrupted");
      const next =
        snapshot.blocks.findIndex((b) => b.text.startsWith(STATUS)) + 2;
      expect(applied.diagnostic?.details?.locations).toEqual([
        `/word/document.xml body block ${next}: signature`,
      ]);
      expect(applied.afterFingerprint).toBe(
        wordDocumentFingerprint(host.ooxml()),
      );
      expect(
        decodeWordInPlaceBackup(applied.before!).inPlace?.scopedFallback,
      ).toBeUndefined();
      host.setReplaceFault(undefined);
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(reverted.outcome?.route).toBe("import");
      expect(wordDocumentFingerprint(host.ooxml())).toBe(original);
    });

    it("keeps later edits and the download when Word also changed a paragraph it was not asked to", async () => {
      const host = install();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      host.setReplaceFault("edits-next");
      const applied = await apply(
        rewrite(snapshot, [[STATUS, { text: "Status: rewritten." }]]),
        snapshot,
      );
      expect(applied.status).toBe("interrupted");
      host.setReplaceFault(undefined);
      host.editParagraph(
        paragraphIndex(host.ooxml(), QUESTIONS),
        "The user kept working here.",
      );
      host.events.length = 0;
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status).toBe("stale");
      expect(reverted.diagnostic?.reason).toBe("source-changed");
      expect(host.insert).not.toHaveBeenCalled();
      expect(mutations(host.events)).toEqual([]);
      expect(host.ooxml()).toContain("The user kept working here.");
    });
  },
);

describe("in-place revert verification", { timeout: 30_000 }, () => {
  async function appliedThen(
    target: typeof STATUS | typeof CLOSING,
    fault: "drops-rpr" | "adds-paragraph" | "edits-next",
  ) {
    const host = install();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      target === CLOSING
        ? closingRewrite(snapshot)
        : rewrite(snapshot, [[STATUS, { text: "Status: rewritten." }]]),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    host.setReplaceFault(fault);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status).toBe("interrupted");
    expect(reverted.afterFingerprint).toBeUndefined();
    expect(reverted.diagnostic).toMatchObject({
      stage: "restore",
      reason: "output-mismatch",
      details: { route: "in-place", verifyTier: "block" },
    });
    return {
      host,
      snapshot,
      locations: reverted.diagnostic!.details!.locations,
    };
  }

  it("fails a Restore whose written paragraph does not come back exactly", async () => {
    const { snapshot, locations } = await appliedThen(CLOSING, "drops-rpr");
    const closing = snapshot.blocks.findIndex((b) => b.text === CLOSING) + 1;
    expect(locations).toEqual([
      `/word/document.xml body block ${closing}: signature`,
    ]);
  });

  it("fails a Restore that adds a paragraph", async () => {
    const { locations } = await appliedThen(CLOSING, "adds-paragraph");
    expect(locations).toEqual(["/word/document.xml body: count"]);
  });

  it("fails a Restore that changes the next paragraph", async () => {
    const { host, locations } = await appliedThen(STATUS, "edits-next");
    const status = predictWordBodyParagraphs(host.ooxml()).findIndex((p) =>
      p.text?.startsWith(STATUS),
    );
    expect(locations).toEqual([
      `/word/document.xml paragraph ${status + 2}: signature`,
    ]);
  });
});
