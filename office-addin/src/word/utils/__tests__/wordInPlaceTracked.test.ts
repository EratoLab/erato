import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  SENTINEL,
  captureRealisticSnapshot,
  realisticWordPackageXml,
} from "../../../test/mocks/word/realisticWordFixtures";
import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import { trackWordApply } from "../wordApplyProgress";
import { decodeWordInPlaceBackup } from "../wordDocumentPackage";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
import { applyWordPlanInPlace } from "../wordInPlaceExecutor";
import { resetWordInPlaceLatchForTests } from "../wordInPlaceSwitch";
import { wordBodyParagraphElements } from "../wordLiveParagraphs";
import { createNativeContentSignature } from "../wordNativeContent";
import { acceptedWordView, rejectedWordView } from "../wordRevisionViews";
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
const STATUS = "Status:";
const SCHEDULE = "Schedule the pilot.";
const REVIEW = "Review at month end.";
const QUESTIONS = "Open questions follow.";
const BUDGET = "Budget owner";
const SUPPORT = "Support model";
const CONFIRM = "Confirm the regions.";
const CLOSING = "Closing paragraph.";
const EARLIER = "Earlier Reviewer";

/** The realistic document with a custom style and an earlier reviewer's pending insertion in the
 * closing paragraph, which no write may touch. */
function fixture(edit: (doc: Document) => void = () => {}): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const styles = doc.getElementsByTagNameNS(W, "styles")[0];
    const callout = new DOMParser().parseFromString(
      `<w:style xmlns:w="${W}" w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/></w:rPr></w:style>`,
      "application/xml",
    ).documentElement;
    styles.append(doc.importNode(callout, true));
    const closing = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
      (t) => t.textContent === CLOSING,
    )!.parentElement!.parentElement!;
    const pending = new DOMParser().parseFromString(
      `<w:ins xmlns:w="${W}" w:id="900" w:author="${EARLIER}" w:date="2026-09-01T00:00:00Z"><w:r><w:t xml:space="preserve"> Added earlier.</w:t></w:r></w:ins>`,
      "application/xml",
    ).documentElement;
    closing.append(doc.importNode(pending, true));
    edit(doc);
  });
}

const paragraphWith = (doc: Document, text: string) =>
  Array.from(doc.getElementsByTagNameNS(W, "t")).find(
    (t) => t.textContent === text,
  )!.parentElement!.parentElement!;
const element = (doc: Document, xml: string) =>
  doc.importNode(
    new DOMParser().parseFromString(xml, "application/xml").documentElement,
    true,
  );
/** An earlier reviewer's pending change of paragraph properties, and nothing else. */
const formattingRevision = (doc: Document) => {
  const props = paragraphWith(doc, SCHEDULE).getElementsByTagNameNS(
    W,
    "pPr",
  )[0];
  props.append(
    element(
      doc,
      `<w:pPrChange xmlns:w="${W}" w:id="901" w:author="${EARLIER}" w:date="2026-09-01T00:00:00Z"><w:pPr/></w:pPrChange>`,
    ),
  );
};
/** A paragraph the signed-in user typed with Track Changes on, right before `text`. Word records
 * it under the same author as the add-in's own revisions. */
const typedBefore = (text: string) => (doc: Document) =>
  paragraphWith(doc, text).before(
    element(
      doc,
      `<w:p xmlns:w="${W}"><w:pPr><w:rPr><w:ins w:id="902" w:author="Mock Reviewer" w:date="2026-10-01T00:00:00Z"/></w:rPr></w:pPr><w:ins w:id="903" w:author="Mock Reviewer" w:date="2026-10-01T00:00:00Z"><w:r><w:t>Typed by the user.</w:t></w:r></w:ins></w:p>`,
    ),
  );

function install(options: WordOoxmlHostOptions = {}, xml: string = fixture()) {
  const host = installWordOoxmlHost(xml, {
    profile: "word-pc-16.0.20326",
    trackChanges: true,
    ...options,
  });
  host.setTrackingMode("TrackAll");
  return host;
}

const capture = () => captureRealisticSnapshot("message-A", "TrackAll");
const refOf = (snapshot: WordAuthoringSnapshot, prefix: string) =>
  snapshot.blocks.find((b) => b.text.startsWith(prefix))!.ref;
const paragraph = (
  id: string,
  text: string,
  extra: Partial<WordPlanBlock> = {},
) => ({ id, type: "paragraph", text, ...extra }) as WordPlanBlock;
const listItem = (
  snapshot: WordAuthoringSnapshot,
  id: string,
  text: string,
  like: string,
) => {
  const source = snapshot.blocks.find((b) => b.text.startsWith(like))!;
  return {
    id,
    type: "list-item",
    text,
    list: source.list,
    level: source.level,
    ordered: source.ordered,
    styleRef: source.styleRef,
  } as WordPlanBlock;
};

interface Change {
  replace?: Record<string, WordPlanBlock[]>;
  merge?: Record<string, string[]>;
  after?: Record<string, WordPlanBlock[]>;
  delete?: string[];
}

function planOf(
  snapshot: WordAuthoringSnapshot,
  change: Change,
): WordDocumentPlan {
  const ref = (prefix: string) => refOf(snapshot, prefix);
  const replaced = new Map(
    Object.entries(change.replace ?? {}).map(([k, v]) => [ref(k), v]),
  );
  const merged = new Map(
    Object.entries(change.merge ?? {}).map(([k, v]) => [ref(k), v.map(ref)]),
  );
  const after = new Map(
    Object.entries(change.after ?? {}).map(([k, v]) => [ref(k), v]),
  );
  const deleted = new Set((change.delete ?? []).map(ref));
  const consumed = new Set([...merged.values()].flat());
  const entries: WordPlanEntry[] = [];
  for (const block of snapshot.blocks) {
    if (consumed.has(block.ref) || deleted.has(block.ref)) continue;
    const blocks = replaced.get(block.ref);
    entries.push(
      blocks
        ? {
            kind: "replace",
            source: [block.ref, ...(merged.get(block.ref) ?? [])],
            blocks,
          }
        : { kind: "keep", source: [block.ref] },
    );
    const inserted = after.get(block.ref);
    if (inserted) entries.push({ kind: "insert", blocks: inserted });
  }
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries,
    deleted: [...deleted].map((source) => ({
      source: [source],
      reason: "Requested removal",
    })),
  };
}

const cellPlan = (snapshot: WordAuthoringSnapshot) =>
  expandWordTableCellSubmission(
    {
      snapshot: snapshot.token,
      readToken: "read-proof",
      table_cell: {
        sourceRef: snapshot.blocks.find((b) => b.nativeKind === "table")!.ref,
        rowIndex: 1,
        cellIndex: 1,
        expectedText: "42",
        text: "43",
      },
    },
    snapshot,
  );

/** Each case and how many paragraphs it writes. */
const cases: [
  string,
  (s: WordAuthoringSnapshot) => WordDocumentPlan,
  touched: number,
][] = [
  [
    "rewrites a paragraph with b/i/u runs",
    (s) =>
      planOf(s, {
        replace: {
          [STATUS]: [
            paragraph("status", "Status: on track and funded.", {
              runs: [
                { text: "Status: ", bold: true },
                { text: "on track", italic: true, underline: true },
                { text: " and funded." },
              ],
            }),
          ],
        },
      }),
    1,
  ],
  ["edits a table cell", cellPlan, 1],
  [
    "inserts a heading after an anchor",
    (s) =>
      planOf(s, {
        after: {
          [STATUS]: [
            { id: "next", type: "heading", level: 2, text: "Next steps" },
          ],
        },
      }),
    1,
  ],
  [
    "inserts a list item that continues an existing list",
    (s) =>
      planOf(s, {
        after: { [REVIEW]: [listItem(s, "item", "Report back.", REVIEW)] },
      }),
    1,
  ],
  ["deletes a list item", (s) => planOf(s, { delete: [SCHEDULE] }), 1],
  [
    "splits one paragraph into three",
    (s) =>
      planOf(s, {
        replace: {
          [QUESTIONS]: [
            paragraph("q0", "Open questions:"),
            paragraph("q1", "Who owns the budget?"),
            paragraph("q2", "Which support model?"),
          ],
        },
      }),
    3,
  ],
  [
    "merges two list items into one",
    (s) =>
      planOf(s, {
        replace: {
          [BUDGET]: [
            listItem(s, "merged", "Budget owner and support model", BUDGET),
          ],
        },
        merge: { [BUDGET]: [SUPPORT] },
      }),
    2,
  ],
  [
    "restyles a paragraph as Heading 2",
    (s) =>
      planOf(s, {
        replace: {
          [QUESTIONS]: [
            { id: "h", type: "heading", level: 2, text: QUESTIONS },
          ],
        },
      }),
    1,
  ],
  [
    "restyles a paragraph with a custom style",
    (s) =>
      planOf(s, {
        replace: {
          [QUESTIONS]: [
            paragraph("callout", "Open questions follow below.", {
              styleRef: "Callout",
            }),
          ],
        },
      }),
    1,
  ],
  [
    "detaches a list item from its list",
    (s) =>
      planOf(s, {
        replace: {
          [SCHEDULE]: [paragraph("p", SCHEDULE, { styleRef: "ListParagraph" })],
        },
      }),
    1,
  ],
  [
    "turns a paragraph into a list item",
    (s) =>
      planOf(s, {
        replace: { [QUESTIONS]: [listItem(s, "item", QUESTIONS, REVIEW)] },
      }),
    1,
  ],
];

const REVISIONS = new Set(["ins", "del", "pPrChange", "rPrChange"]);
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
/** Body paragraphs carrying a revision, by text, leaving out the earlier reviewer's one. */
const revised = (ooxml: string) =>
  wordBodyParagraphElements(parse(ooxml)).filter(
    (p) =>
      Array.from(p.getElementsByTagNameNS(W, "*")).some(
        (e) =>
          REVISIONS.has(e.localName) &&
          e.getAttributeNS(W, "author") !== EARLIER,
      ) && !p.textContent?.includes(CLOSING),
  );
const bodySignatures = (ooxml: string) => {
  const snapshot = captureWordAuthoringSnapshot(
    ooxml,
    "doc-A",
    "Off",
    true,
    "verify",
  );
  const signature = createNativeContentSignature(ooxml);
  return snapshot.blocks.map((b) => signature(b.xml));
};
const report = (
  result: WordDocumentApplyResult | WordDocumentRevertResult,
  operation = "apply",
) => renderWordDiagnosticReport(operation, result.status, result.diagnostic);
const apply = (plan: WordDocumentPlan, snapshot: WordAuthoringSnapshot) =>
  applyWordDocumentPlan(
    JSON.stringify(plan),
    snapshot,
    snapshot.ownerMessageId,
  );
const mutations = (events: string[]) =>
  events.filter((e) => e.startsWith("mutation:"));
const earlierRevision = (ooxml: string) =>
  ooxml.includes(
    `w:author="${EARLIER}" w:date="2026-09-01T00:00:00Z"><w:r><w:t xml:space="preserve"> Added earlier.</w:t></w:r></w:ins>`,
  );

/** What the same plan writes with Track Changes off. */
async function untrackedResult(
  plan: (s: WordAuthoringSnapshot) => WordDocumentPlan,
): Promise<string> {
  const host = installWordOoxmlHost(fixture(), {
    profile: "word-pc-16.0.20326",
  });
  const snapshot = await captureRealisticSnapshot();
  const result = await apply(plan(snapshot), snapshot);
  expect(result.status, report(result)).toBe("applied");
  const ooxml = host.ooxml();
  vi.unstubAllGlobals();
  return ooxml;
}

afterEach(() => {
  resetWordInPlaceLatchForTests();
  setWordInPlaceCapabilitiesForTests(undefined);
  delete window.WORD_FORCE_IMPORT_APPLY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("in-place writes as tracked changes", { timeout: 60_000 }, () => {
  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  it.each(cases)(
    "%s as revisions and rejects exactly those on Restore",
    async (_name, plan, touched) => {
      const expected = await untrackedResult(plan);
      const host = install();
      const original = host.ooxml();
      const snapshot = await capture();
      expect(snapshot.issue).toBeUndefined();
      const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
      const getter = vi.spyOn(host.document, "changeTrackingMode", "get");
      const applied = await apply(plan(snapshot), snapshot);
      expect(applied.status, report(applied)).toBe("applied");
      expect(applied.outcome).toMatchObject({
        route: "in-place",
        tier: "block",
        tracked: true,
      });
      expect(host.insert).not.toHaveBeenCalled();
      expect(setter).not.toHaveBeenCalled();
      expect(getter.mock.calls.length).toBeGreaterThanOrEqual(2);
      const after = host.ooxml();
      expect(revised(after)).toHaveLength(touched);
      expect(bodySignatures(acceptedWordView(after))).toEqual(
        bodySignatures(acceptedWordView(expected)),
      );
      expect(bodySignatures(rejectedWordView(after))).toEqual(
        bodySignatures(rejectedWordView(original)),
      );
      expect(earlierRevision(after)).toBe(true);
      expect(decodeWordInPlaceBackup(applied.before!).inPlace?.tracked).toBe(
        true,
      );

      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(setter).not.toHaveBeenCalled();
      expect(host.insert).not.toHaveBeenCalled();
      expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
      expect(revised(host.ooxml())).toEqual([]);
      expect(earlierRevision(host.ooxml())).toBe(true);
    },
  );

  it("marks only the changed word, not the whole paragraph", async () => {
    const host = install();
    const snapshot = await capture();
    const applied = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [
            listItem(snapshot, "s", "Schedule the trial.", SCHEDULE),
          ],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const [written] = revised(host.ooxml());
    const text = (name: string) =>
      Array.from(written.getElementsByTagNameNS(W, name)).map(
        (e) => e.textContent,
      );
    expect(text("delText")).toEqual(["pilot."]);
    expect(
      Array.from(written.getElementsByTagNameNS(W, "ins")).map(
        (e) => e.textContent,
      ),
    ).toEqual(["trial."]);
    expect(text("t").join("")).toBe("Schedule the trial.");
  });

  it("rewrites the whole paragraph when the word ranges do not rejoin to its text", async () => {
    const host = install({ textRangesTrimSpacing: true });
    const snapshot = await capture();
    const applied = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [
            listItem(snapshot, "s", "Schedule the trial.", SCHEDULE),
          ],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome?.tracked).toBe(true);
    const [written] = revised(host.ooxml());
    expect(
      Array.from(written.getElementsByTagNameNS(W, "delText"))
        .map((e) => e.textContent)
        .join(""),
    ).toBe(SCHEDULE);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
  });

  it("refuses Restore once a reviewer accepted one of the changes", async () => {
    const host = install();
    const snapshot = await capture();
    const applied = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [
            listItem(snapshot, "s", "Schedule the trial.", SCHEDULE),
          ],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const index = wordBodyParagraphElements(parse(host.ooxml())).findIndex(
      (p) => p.textContent?.startsWith("Schedule the"),
    );
    host.reviewParagraph(index, "accept");
    const accepted = host.ooxml();
    host.events.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status).toBe("stale");
    expect(reverted.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "source-changed",
    });
    expect(mutations(host.events)).toEqual([]);
    expect(host.ooxml()).toBe(accepted);
  });

  it("restores in any mode once Track Changes was turned off", async () => {
    const host = install();
    const snapshot = await capture();
    const applied = await apply(
      planOf(snapshot, { delete: [SCHEDULE] }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const original = bodySignatures(fixture());
    host.setTrackingMode("Off");
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(bodySignatures(host.ooxml())).toEqual(original);
  });

  it("writes directly when Track Changes was turned off after the capture", async () => {
    const host = install();
    const snapshot = await capture();
    host.setTrackingMode("Off");
    const applied = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [
            listItem(snapshot, "s", "Schedule the trial.", SCHEDULE),
          ],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome).toMatchObject({
      route: "in-place",
      tracked: false,
    });
    expect(revised(host.ooxml())).toEqual([]);
  });

  it("does not verify, and keeps text out of the report, when someone edits a neighbour mid-write", async () => {
    const host = install();
    const snapshot = await capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const index = wordBodyParagraphElements(parse(host.ooxml())).findIndex(
      (p) => p.textContent === QUESTIONS,
    );
    // Sync A, sync B, then the write batch.
    host.editParagraph(index, `${SENTINEL} typed meanwhile`, { afterSync: 3 });
    const result = await apply(
      planOf(snapshot, {
        replace: {
          [REVIEW]: [listItem(snapshot, "r", "Review at quarter end.", REVIEW)],
        },
      }),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "verify",
      reason: "output-mismatch",
      details: { route: "in-place", verifyTier: "block" },
    });
    expect(result.diagnostic?.details?.locations).toContain(
      `/word/document.xml body block ${
        snapshot.blocks.findIndex((b) => b.text === QUESTIONS) + 1
      }: signature`,
    );
    const text = [
      renderWordDiagnosticReport("apply", result.status, result.diagnostic),
      ...warn.mock.calls.flat().map(String),
    ].join("\n");
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("quarter end");
    expect(text).not.toContain(EARLIER);
  });

  it("restores an unverified tracked write by rejecting it, also once Track Changes is off", async () => {
    const host = install({ reviewedOriginalIsCurrent: true });
    const snapshot = await capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [
            listItem(snapshot, "s", `Schedule the ${SENTINEL}.`, SCHEDULE),
          ],
        },
      }),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic?.details?.locations).toEqual([
      expect.stringMatching(/^\/word\/document\.xml body block \d+: reviewed$/),
    ]);
    expect(result.afterFingerprint).toMatch(/^word-scope-v1:/);
    // Word notes the switch in settings.xml, so the exact package restore can no longer run.
    host.setTrackingMode("Off");
    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(reverted.outcome?.route).toBe("in-place");
    expect(host.insert).not.toHaveBeenCalled();
    expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(fixture()));
    expect(revised(host.ooxml())).toEqual([]);
    expect(earlierRevision(host.ooxml())).toBe(true);
    const text = [
      report(result),
      report(reverted, "revert"),
      ...warn.mock.calls.flat().map(String),
    ].join("\n");
    expect(text).not.toContain(SENTINEL);
  });

  it("keeps the paragraph mark when Word's last word range also holds it", async () => {
    const host = install({ textRangesIncludeParagraphMark: true });
    const snapshot = await capture();
    const ids = host.paragraphIds();
    const applied = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [
            listItem(snapshot, "s", "Schedule the trial.", SCHEDULE),
          ],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(host.paragraphIds()).toEqual(ids);
    const [written] = revised(host.ooxml());
    expect(written.getElementsByTagNameNS(W, "pPr")[0].innerHTML).not.toContain(
      "w:del",
    );
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(fixture()));
  });

  it("refuses to reject a change Word merged with the user's own pending paragraph", async () => {
    const xml = fixture(typedBefore(QUESTIONS));
    const host = install({ coalesceInsertions: true }, xml);
    const snapshot = await capture();
    expect(
      snapshot.blocks.find((b) => b.text === "Typed by the user."),
    ).toMatchObject({ type: "native", nativeKind: "anchored-content" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await apply(
      planOf(snapshot, {
        replace: { [QUESTIONS]: [paragraph("q", `First, ${QUESTIONS}`)] },
      }),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic?.details?.locations).toContain(
      "/word/document.xml: revisions",
    );
    const written = host.ooxml();
    host.events.length = 0;
    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status).toBe("stale");
    expect(reverted.diagnostic?.details?.locations).toEqual([
      expect.stringMatching(/body block \d+: revisions$/),
    ]);
    expect(mutations(host.events)).toEqual([]);
    expect(host.ooxml()).toBe(written);
    expect(host.ooxml()).toContain("Typed by the user.");
  });

  it("keeps tracked text out of the report when Word stops mid-write", async () => {
    const host = install();
    const snapshot = await capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    host.failAtCommand(2, `Word rejected "${SENTINEL} moved to review."`);
    const result = await apply(
      planOf(snapshot, {
        replace: {
          [STATUS]: [
            paragraph("status", `Status: ${SENTINEL} moved to review.`, {
              runs: [
                { text: "Status: ", bold: true },
                { text: `${SENTINEL} moved to review.` },
              ],
            }),
          ],
        },
      }),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    const record = decodeWordInPlaceBackup(result.before!).inPlace;
    expect(record?.tracked).toBe(true);
    expect(Object.keys(record?.revisions ?? {})).toHaveLength(1);
    const text = [
      renderWordDiagnosticReport("apply", result.status, result.diagnostic),
      ...warn.mock.calls.flat().map(String),
    ].join("\n");
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("moved to review");
    expect(text).not.toContain("word-scope-v1:");
    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(fixture()));
  });
});

describe("tracked verification failures", { timeout: 60_000 }, () => {
  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  const failure = async (
    options: WordOoxmlHostOptions,
    plan: (s: WordAuthoringSnapshot) => WordDocumentPlan,
    before?: (host: ReturnType<typeof install>) => void,
  ) => {
    const host = install(options);
    const snapshot = await capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    before?.(host);
    const result = await apply(plan(snapshot), snapshot);
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "verify",
      reason: "output-mismatch",
    });
    const text = [report(result), ...warn.mock.calls.flat().map(String)].join(
      "\n",
    );
    expect(text).not.toContain(SENTINEL);
    return { host, result, locations: result.diagnostic!.details!.locations! };
  };

  it("reports a restyle Word left untracked as not rejectable", async () => {
    const { locations } = await failure({ untrackedFormatting: true }, (s) =>
      planOf(s, {
        replace: {
          [QUESTIONS]: [
            {
              id: "h",
              type: "heading",
              level: 2,
              text: `Open ${SENTINEL} questions follow.`,
            },
          ],
        },
      }),
    );
    expect(locations).toContainEqual(
      expect.stringMatching(/^\/word\/document\.xml body block \d+: rejected$/),
    );
  });

  it("reports an insertion that also marked its anchor as a revision outside the write", async () => {
    const { locations } = await failure({ insertMarksAnchor: true }, (s) =>
      planOf(s, {
        after: { [STATUS]: [paragraph("n", `${SENTINEL} next steps`)] },
      }),
    );
    expect(locations).toContain("/word/document.xml: revisions");
  });

  it("reports reviewed text that does not read as the original", async () => {
    const { locations } = await failure(
      { reviewedOriginalIsCurrent: true },
      (s) =>
        planOf(s, {
          replace: {
            [REVIEW]: [listItem(s, "r", `Review ${SENTINEL} end.`, REVIEW)],
          },
        }),
    );
    expect(locations).toEqual([expect.stringMatching(/: reviewed$/)]);
  });

  it("reports Track Changes switched during the write, and still restores", async () => {
    const { host, result, locations } = await failure(
      {},
      (s) =>
        planOf(s, {
          replace: {
            [REVIEW]: [listItem(s, "r", `Review ${SENTINEL} end.`, REVIEW)],
          },
        }),
      // Sync A, sync B, then the write batch.
      (host) => host.setTrackingMode("Off", { afterSync: 3 }),
    );
    expect(locations).toEqual(["/word/settings.xml: tracking-changed"]);
    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(fixture()));
  });
});

describe("Track Changes gates", { timeout: 60_000 }, () => {
  const context = {
    chatId: "chat",
    messageId: "message-A",
    toolCallId: "read",
  };
  const withSection = (snapshot: WordAuthoringSnapshot): WordDocumentPlan => ({
    ...planOf(snapshot, {}),
    sections: [{ id: "final", source: "section-1" }],
  });

  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  it("blocks a plan that needs the import and names why", async () => {
    const host = install();
    const snapshot = await capture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.events.length = 0;
    const save = vi.fn();
    const result = await applyWordDocumentPlan(
      JSON.stringify(withSection(snapshot)),
      snapshot,
      snapshot.ownerMessageId,
      save,
    );
    expect(result.status).toBe("blocked");
    expect(result.diagnostic).toMatchObject({
      stage: "validate",
      reason: "tracking",
      details: { route: "import", fallbackReasons: ["sections"] },
    });
    expect(report(result)).toContain("Needs full rewrite: sections");
    expect(save).not.toHaveBeenCalled();
    expect(host.events).toEqual([]);
    expect(host.insert).not.toHaveBeenCalled();
    expect(snapshot.used).toBe(false);
  });

  it("blocks an import route when Track Changes was turned on after the capture", async () => {
    const host = install();
    host.setTrackingMode("Off");
    const snapshot = await captureRealisticSnapshot();
    host.setTrackingMode("TrackAll");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await apply(withSection(snapshot), snapshot);
    expect(result.status).toBe("blocked");
    expect(result.diagnostic).toMatchObject({
      stage: "validate",
      reason: "tracking",
      details: { fallbackReasons: ["sections"] },
    });
    expect(host.insert).not.toHaveBeenCalled();
    expect(snapshot.used).toBe(false);
  });

  it("tells the model at submission which features need a full rewrite", async () => {
    install();
    const snapshot = await capture();
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    const read = await session.execute({ snapshot: snapshot.token }, context);
    expect(read.ok).toBe(true);
    const submit = createWordDocumentSubmissionExecutor(session);
    const plan = { ...withSection(snapshot), readToken: snapshot.readToken! };
    const rejected = await submit(plan, { ...context, toolCallId: "plan-1" });
    expect(rejected).toMatchObject({
      ok: false,
      validationErrors: [
        expect.objectContaining({
          code: "tracking-needs-import",
          message: expect.stringContaining("because of: sections."),
        }),
      ],
    });
    const accepted = await submit(
      {
        ...planOf(snapshot, {
          replace: {
            [CONFIRM]: [
              listItem(snapshot, "c", "Confirm all regions.", CONFIRM),
            ],
          },
        }),
        readToken: snapshot.readToken!,
      },
      { ...context, toolCallId: "plan-2" },
    );
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  });

  it("never targets a paragraph with pending revisions", async () => {
    install();
    const snapshot = await capture();
    const closing = snapshot.blocks.find((b) => b.text.startsWith(CLOSING))!;
    expect(closing).toMatchObject({
      type: "native",
      nativeKind: "anchored-content",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await apply(
      planOf(snapshot, {
        replace: { [CLOSING]: [paragraph("c", "Closing words.")] },
      }),
      snapshot,
    );
    expect(result.status).toBe("blocked");
    expect(result.diagnostic?.details?.fallbackReasons).toContain(
      "native-target",
    );
  });

  it("never targets a paragraph whose only pending revision is formatting", async () => {
    const host = install({}, fixture(formattingRevision));
    const snapshot = await capture();
    expect(snapshot.blocks.find((b) => b.text === SCHEDULE)).toMatchObject({
      type: "native",
      nativeKind: "anchored-content",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.events.length = 0;
    const result = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [listItem(snapshot, "s", "Schedule the trial.", CONFIRM)],
        },
      }),
      snapshot,
    );
    expect(result.status).toBe("blocked");
    expect(result.diagnostic?.details?.fallbackReasons).toContain(
      "native-target",
    );
    expect(mutations(host.events)).toEqual([]);
    expect(snapshot.used).toBe(false);
  });

  it("keeps a paragraph it restyled as tracked keep-only until the change is reviewed", async () => {
    install();
    const snapshot = await capture();
    const applied = await apply(
      planOf(snapshot, {
        replace: {
          [QUESTIONS]: [
            { id: "h", type: "heading", level: 2, text: QUESTIONS },
          ],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const again = await captureRealisticSnapshot("message-B", "TrackAll");
    expect(again.blocks.find((b) => b.text === QUESTIONS)).toMatchObject({
      type: "native",
      nativeKind: "anchored-content",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = await applyWordDocumentPlan(
      JSON.stringify(
        planOf(again, {
          replace: { [QUESTIONS]: [paragraph("q", "Open questions remain.")] },
        }),
      ),
      again,
      again.ownerMessageId,
    );
    expect(second.status).toBe("blocked");
    expect(second.diagnostic?.details?.fallbackReasons).toContain(
      "native-target",
    );
  });

  it("blocks structural changes under Track Changes until their tracked probe passed", async () => {
    setWordInPlaceCapabilitiesForTests({
      ...ALL_WORD_IN_PLACE_CAPABILITIES,
      trackedStructure: false,
    });
    const host = install();
    const snapshot = await capture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.events.length = 0;
    const deleted = await apply(
      planOf(snapshot, { delete: [SCHEDULE] }),
      snapshot,
    );
    expect(deleted.status).toBe("blocked");
    expect(deleted.diagnostic).toMatchObject({
      stage: "validate",
      reason: "tracking",
      details: { fallbackReasons: ["delete"] },
    });
    expect(mutations(host.events)).toEqual([]);
    const read = await capture();
    const session = new WordDocumentReadSession();
    session.activate(read, context);
    await session.execute({ snapshot: read.token }, context);
    const submit = createWordDocumentSubmissionExecutor(session);
    const rejected = await submit(
      {
        ...planOf(read, {
          replace: {
            [QUESTIONS]: [
              { id: "h", type: "heading", level: 2, text: QUESTIONS },
            ],
          },
        }),
        readToken: read.readToken!,
      },
      { ...context, toolCallId: "plan-1" },
    );
    expect(rejected).toMatchObject({
      ok: false,
      validationErrors: [
        expect.objectContaining({
          code: "tracking-needs-import",
          message: expect.stringContaining("because of: restyle."),
        }),
      ],
    });
    const applied = await apply(
      planOf(snapshot, {
        replace: {
          [SCHEDULE]: [
            listItem(snapshot, "s", "Schedule the trial.", SCHEDULE),
          ],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome?.tracked).toBe(true);
  });

  it("blocks a structural plan when Track Changes came on after the capture", async () => {
    setWordInPlaceCapabilitiesForTests({
      ...ALL_WORD_IN_PLACE_CAPABILITIES,
      trackedStructure: false,
    });
    const host = install();
    host.setTrackingMode("Off");
    const snapshot = await captureRealisticSnapshot();
    host.setTrackingMode("TrackAll");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.events.length = 0;
    const save = vi.fn();
    const result = await applyWordDocumentPlan(
      JSON.stringify(planOf(snapshot, { delete: [SCHEDULE] })),
      snapshot,
      snapshot.ownerMessageId,
      save,
    );
    expect(result.status).toBe("blocked");
    expect(result.diagnostic).toMatchObject({
      reason: "tracking",
      details: { fallbackReasons: ["delete"] },
    });
    expect(save).not.toHaveBeenCalled();
    expect(mutations(host.events)).toEqual([]);
    expect(snapshot.used).toBe(false);
  });

  it("blocks a tracked insertion next to a paragraph with pending revisions", async () => {
    const xml = fixture((doc) =>
      paragraphWith(doc, CONFIRM).append(
        element(
          doc,
          `<w:ins xmlns:w="${W}" w:id="904" w:author="${EARLIER}" w:date="2026-09-01T00:00:00Z"><w:r><w:t xml:space="preserve"> Soon.</w:t></w:r></w:ins>`,
        ),
      ),
    );
    const host = install({}, xml);
    const snapshot = await capture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.events.length = 0;
    const result = await apply(
      planOf(snapshot, {
        after: { [STATUS]: [paragraph("n", "Next steps follow.")] },
      }),
      snapshot,
    );
    expect(result.status).toBe("blocked");
    expect(result.diagnostic).toMatchObject({
      reason: "tracking",
      details: { fallbackReasons: ["boundary"] },
    });
    expect(mutations(host.events)).toEqual([]);
    expect(snapshot.used).toBe(false);
  });

  it("refuses a tracked write to a paragraph that already holds revisions, even when admitted", async () => {
    const host = install();
    const snapshot = await capture();
    const before = host.ooxml();
    const plain = { bold: false, italic: false, underline: false };
    const plan = planOf(snapshot, {
      replace: { [CLOSING]: [paragraph("c", "Closing paragraph, revised.")] },
    });
    host.events.length = 0;
    // Mis-admitted on purpose: the earlier reviewer's insertion makes this block native.
    const result = await applyWordPlanInPlace({
      snapshot,
      compiled: captureWordAuthoringSnapshot(
        compileWordDocumentPlan(plan, snapshot),
        snapshot.identity,
        "Off",
        true,
        "verify",
      ),
      ops: [
        {
          kind: "text",
          ref: refOf(snapshot, CLOSING),
          paragraph: 0,
          runs: [{ text: "Closing paragraph, revised.", ...plain }],
          original: [{ text: `${CLOSING} Added earlier.`, ...plain }],
        },
      ],
      progress: trackWordApply("plan"),
      observePackage: async () => undefined,
    });
    expect(result).toEqual({
      fallback: "tracking",
      details: { fallbackReasons: ["native-target"] },
    });
    expect(mutations(host.events)).toEqual([]);
    expect(host.ooxml()).toBe(before);
  });

  it("keeps the earlier capture issue when tracked writing is unavailable", async () => {
    install();
    setWordInPlaceCapabilitiesForTests(undefined);
    expect((await capture()).issue).toBe("tracking");
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    window.WORD_FORCE_IMPORT_APPLY = true;
    expect((await capture()).issue).toBe("tracking");
    delete window.WORD_FORCE_IMPORT_APPLY;
    expect((await capture()).issue).toBeUndefined();
    const file = await captureRealisticSnapshot();
    expect(
      captureWordAuthoringSnapshot(
        file.ooxml,
        "doc-A",
        "TrackAll",
        true,
        "verify",
      ).issue,
    ).toBe("tracking");
    expect(
      captureWordAuthoringSnapshot(file.ooxml, "doc-A", "TrackAll", false)
        .issue,
    ).toBe("tracking");
  });
});
