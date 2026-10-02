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
import { wordPackageCounts } from "../wordFullDocumentComparison";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
import {
  applyWordPlanInPlace,
  wordInPlaceFallbackScope,
} from "../wordInPlaceExecutor";
import {
  classifyWordInPlacePlan,
  sameWordInPlaceProgram,
} from "../wordInPlacePlan";
import {
  resetWordInPlaceLatchForTests,
  wordInPlaceAvailability,
} from "../wordInPlaceSwitch";
import { createNativeContentSignature } from "../wordNativeContent";

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

/** The realistic SharePoint-style document plus one custom paragraph style. */
function fixture(edit: (doc: Document) => void = () => {}): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const styles = doc.getElementsByTagNameNS(W, "styles")[0];
    const callout = new DOMParser().parseFromString(
      `<w:style xmlns:w="${W}" w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/></w:rPr></w:style>`,
      "application/xml",
    ).documentElement;
    styles.append(doc.importNode(callout, true));
    edit(doc);
  });
}

function install(options: WordOoxmlHostOptions = {}, xml = fixture()) {
  return installWordOoxmlHost(xml, {
    profile: "word-pc-16.0.20326",
    ...options,
  });
}

const refOf = (snapshot: WordAuthoringSnapshot, prefix: string) =>
  snapshot.blocks.find((b) => b.text.startsWith(prefix))!.ref;
const paragraph = (
  id: string,
  text: string,
  extra: Partial<WordPlanBlock> = {},
) => ({ id, type: "paragraph", text, ...extra }) as WordPlanBlock;

interface Change {
  /** Inserted before the first block. */
  start?: WordPlanBlock[];
  replace?: Record<string, WordPlanBlock[]>;
  /** Merged into the previous replaced block: sources consumed by a replace entry. */
  merge?: Record<string, string[]>;
  after?: Record<string, WordPlanBlock[]>;
  delete?: string[];
}

/** Keep everything except the changes, keyed by text prefixes of captured blocks. */
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
  const entries: WordPlanEntry[] = change.start
    ? [{ kind: "insert", blocks: change.start }]
    : [];
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

const cases: [string, (s: WordAuthoringSnapshot) => Change][] = [
  [
    "inserts a heading after an anchor",
    () => ({
      after: {
        [STATUS]: [
          { id: "next", type: "heading", level: 2, text: "Next steps" },
        ],
      },
    }),
  ],
  [
    "inserts a list item that continues an existing list",
    (s) => ({
      after: { [REVIEW]: [listItem(s, "item", "Report back.", REVIEW)] },
    }),
  ],
  ["deletes a list item", () => ({ delete: [SCHEDULE] })],
  [
    "inserts a paragraph before the first block",
    () => ({ start: [paragraph("first", "A new opening line.")] }),
  ],
  // Re-created next to a paragraph whose style and list membership differ from its own.
  ["deletes the first item of a list", () => ({ delete: [CONFIRM] })],
  [
    "deletes a paragraph that follows a list item",
    () => ({ delete: [QUESTIONS] }),
  ],
  ["deletes the opening heading", () => ({ delete: [SENTINEL] })],
  [
    "reshapes a heading and paragraph into three blocks",
    () => ({
      replace: {
        [SENTINEL]: [
          { id: "h", type: "heading", level: 1, text: "Quarterly plan" },
          paragraph("p1", "Status: on track."),
          paragraph("p2", "Next review in May."),
        ],
      },
      merge: { [SENTINEL]: [STATUS] },
    }),
  ],
  [
    "splits one paragraph into three",
    () => ({
      replace: {
        [QUESTIONS]: [
          paragraph("q0", "Open questions:"),
          paragraph("q1", "Who owns the budget?", {
            runs: [
              { text: "Who owns the " },
              { text: "budget", bold: true },
              { text: "?" },
            ],
          }),
          paragraph("q2", "Which support model?"),
        ],
      },
    }),
  ],
  [
    "merges two list items into one",
    (s) => ({
      replace: {
        [BUDGET]: [
          listItem(s, "merged", "Budget owner and support model", BUDGET),
        ],
      },
      merge: { [BUDGET]: [SUPPORT] },
    }),
  ],
  [
    "restyles a paragraph as Heading 2",
    () => ({
      replace: {
        [QUESTIONS]: [{ id: "h", type: "heading", level: 2, text: QUESTIONS }],
      },
    }),
  ],
  [
    "detaches a list item from its list",
    () => ({
      replace: {
        [SCHEDULE]: [paragraph("p", SCHEDULE, { styleRef: "ListParagraph" })],
      },
    }),
  ],
  [
    "turns a paragraph into a list item",
    (s) => ({
      replace: {
        [QUESTIONS]: [listItem(s, "item", QUESTIONS, REVIEW)],
      },
    }),
  ],
  [
    "restyles a paragraph with a custom style",
    () => ({
      replace: {
        [QUESTIONS]: [
          paragraph("callout", "Open questions follow below.", {
            styleRef: "Callout",
          }),
        ],
      },
    }),
  ],
];

const changeOf = (name: string, snapshot: WordAuthoringSnapshot) =>
  cases.find(([n]) => n === name)![1](snapshot);

/** Shape that must not change in place: parts, customXml, custom properties and numbering. */
const shape = (ooxml: string) => {
  const counts = wordPackageCounts(ooxml);
  return {
    parts: counts.parts,
    customXmlItems: counts.customXmlItems,
    customProperties: counts.customProperties,
    abstractNums: counts.abstractNums,
    nums: counts.nums,
    webextensionParts: counts.webextensionParts,
  };
};
/** Body blocks by content, so a re-created paragraph with a new ID still compares equal. */
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

afterEach(() => {
  resetWordInPlaceLatchForTests();
  setWordInPlaceCapabilitiesForTests(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("structural in-place writes", { timeout: 30_000 }, () => {
  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  it("continues the captured list instance", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      planOf(snapshot, {
        after: {
          [REVIEW]: [listItem(snapshot, "item", "Report back.", REVIEW)],
        },
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const after = captureWordAuthoringSnapshot(
      host.ooxml(),
      "doc-A",
      "Off",
      true,
      "verify",
    );
    const items = after.blocks.filter((b) => b.list === "existing-1");
    expect(items.map((b) => b.text)).toEqual([
      "Confirm the regions.",
      SCHEDULE,
      REVIEW,
      "Report back.",
    ]);
    expect(items.at(-1)!.xml).toContain('<w:numId w:val="1"/>');
  });

  it.each(cases)("%s and reverts it exactly", async (_name, change) => {
    const host = install();
    const original = host.ooxml();
    const snapshot = await captureRealisticSnapshot();
    const plan = planOf(snapshot, change(snapshot));
    const idsBefore = host.paragraphIds();
    const applied = await apply(plan, snapshot);
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome).toMatchObject({ route: "in-place", tier: "block" });
    expect(host.insert).not.toHaveBeenCalled();
    expect(shape(host.ooxml())).toEqual(shape(original));
    const inserted = host
      .paragraphIds()
      .filter((id) => !idsBefore.includes(id));
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(reverted.outcome?.route).toBe("in-place");
    expect(host.insert).not.toHaveBeenCalled();
    expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
    expect(host.paragraphIds().filter((id) => inserted.includes(id))).toEqual(
      [],
    );
    expect(shape(host.ooxml())).toEqual(shape(original));
  });
});

describe(
  "structural in-place admission and identity",
  { timeout: 30_000 },
  () => {
    beforeEach(() =>
      setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
    );

    /** "Open questions follow." with direct spacing, which the object model cannot clear. */
    const spaced = () =>
      fixture((doc) => {
        const paragraph = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
          (t) => t.textContent === QUESTIONS,
        )!.parentElement!.parentElement!;
        const props = new DOMParser().parseFromString(
          `<w:pPr xmlns:w="${W}"><w:spacing w:before="240"/></w:pPr>`,
          "application/xml",
        ).documentElement;
        paragraph.prepend(doc.importNode(props, true));
      });

    it("routes an insert next to a paragraph with direct formatting to the import before touching Word", async () => {
      const host = install({}, spaced());
      const snapshot = await captureRealisticSnapshot();
      host.events.length = 0;
      const plan = planOf(snapshot, {
        after: { [QUESTIONS]: [paragraph("p", "A new paragraph.")] },
      });
      expect(
        classifyWordInPlacePlan(plan, snapshot, ALL_WORD_IN_PLACE_CAPABILITIES),
      ).toEqual({
        fallback: "inherited-format",
      });
      expect(host.events).toEqual([]);
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      const result = await apply(plan, snapshot);
      expect(result.status, report(result)).toBe("applied");
      expect(result.outcome?.route).toBe("import");
      expect(debug).toHaveBeenLastCalledWith(
        "[erato] Word apply timings (ms)",
        expect.objectContaining({ routeReason: "inherited-format" }),
      );
    });

    it("fails verification when Word hands the anchor's formatting to an inserted paragraph", async () => {
      install({ insertInheritsAnchorProperties: true }, spaced());
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      const plan = planOf(snapshot, {
        after: { [QUESTIONS]: [paragraph("p", "A new paragraph.")] },
      });
      const compiled = captureWordAuthoringSnapshot(
        compileWordDocumentPlan(plan, snapshot),
        snapshot.identity,
        "Off",
        true,
        "verify",
      );
      // Mis-admitted on purpose: the classifier would have sent this to the import.
      const result = await applyWordPlanInPlace({
        snapshot,
        compiled,
        ops: [
          {
            kind: "insert",
            ref: refOf(snapshot, QUESTIONS),
            paragraph: 0,
            location: "After",
            block: "p",
            runs: [
              {
                text: "A new paragraph.",
                bold: false,
                italic: false,
                underline: false,
              },
            ],
            state: { type: "paragraph", style: { builtIn: "Normal" } },
          },
        ],
        progress: trackWordApply("plan"),
        observePackage: async () => undefined,
      });
      expect("status" in result && result.status).toBe("interrupted");
      const index = snapshot.blocks.findIndex((b) => b.text === QUESTIONS) + 2;
      expect("diagnostic" in result && result.diagnostic).toMatchObject({
        stage: "verify",
        reason: "output-mismatch",
        details: {
          route: "in-place",
          verifyTier: "block",
          locations: [`/word/document.xml body block ${index}: format`],
        },
      });
      expect(wordInPlaceAvailability()).toEqual({
        enabled: false,
        reason: "latched",
      });
      // Restore must not rewrite through the mechanism that just misbehaved.
      const before = "before" in result ? result.before! : "";
      expect(decodeWordInPlaceBackup(before).inPlace?.scopedFallback).toBe(
        undefined,
      );
      expect(wordInPlaceFallbackScope(before)).toBeUndefined();
    });

    it("fails verification when attaching to a list starts a new list instance", async () => {
      const host = install({ attachToListNewNum: true });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      // Anchored after the status paragraph, which is not a list item: the new item must attach.
      const plan = planOf(snapshot, {
        after: {
          [STATUS]: [
            listItem(
              snapshot,
              "first",
              "Agree the scope.",
              "Confirm the regions.",
            ),
          ],
        },
      });
      const result = await apply(plan, snapshot);
      expect(result.status).toBe("interrupted");
      const index =
        snapshot.blocks.findIndex((b) => b.text.startsWith(STATUS)) + 2;
      expect(result.diagnostic).toMatchObject({
        stage: "verify",
        reason: "output-mismatch",
        details: {
          route: "in-place",
          locations: [`/word/document.xml body block ${index}: list`],
        },
      });
      expect(mutations(host.events)).toContain("mutation:attachToList");
      expect(wordInPlaceAvailability()).toEqual({
        enabled: false,
        reason: "latched",
      });
      expect(
        decodeWordInPlaceBackup(result.before!).inPlace?.scopedFallback,
      ).toBe(undefined);
      expect(wordInPlaceFallbackScope(result.before!)).toBeUndefined();
    });

    it.each([
      [
        "an insert after the final paragraph",
        { after: { [CLOSING]: [paragraph("p", "A closing remark.")] } },
      ],
      [
        "a split of the final paragraph",
        {
          replace: {
            [CLOSING]: [
              paragraph("a", CLOSING),
              paragraph("b", "A closing remark."),
            ],
          },
        },
      ],
    ])(
      "routes %s to the import, since undoing it would delete the final paragraph",
      async (_name, change: Change) => {
        const host = install();
        const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const snapshot = await captureRealisticSnapshot();
        const plan = planOf(snapshot, change);
        expect(
          classifyWordInPlacePlan(
            plan,
            snapshot,
            ALL_WORD_IN_PLACE_CAPABILITIES,
          ),
        ).toEqual({ fallback: "boundary" });
        const result = await apply(plan, snapshot);
        expect(result.status, report(result)).toBe("applied");
        expect(result.outcome?.route).toBe("import");
        expect(mutations(host.events)).toEqual([]);
        expect(debug).toHaveBeenLastCalledWith(
          "[erato] Word apply timings (ms)",
          expect.objectContaining({ routeReason: "boundary" }),
        );
      },
    );

    it("cannot undo a mis-admitted insert after the final paragraph, as Word keeps that paragraph", async () => {
      install();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      const plan = planOf(snapshot, {
        after: { [CLOSING]: [paragraph("p", "A closing remark.")] },
      });
      const applied = await applyWordPlanInPlace({
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
            kind: "insert",
            ref: refOf(snapshot, CLOSING),
            paragraph: 0,
            location: "After",
            block: "p",
            runs: [
              {
                text: "A closing remark.",
                bold: false,
                italic: false,
                underline: false,
              },
            ],
            state: { type: "paragraph", style: { builtIn: "Normal" } },
          },
        ],
        progress: trackWordApply("plan"),
        observePackage: async () => undefined,
      });
      expect("status" in applied && applied.status).toBe("applied");
      const result = applied as WordDocumentApplyResult;
      const reverted = await revertWordDocumentPlan(
        result.before!,
        result.afterFingerprint!,
      );
      expect(reverted.status).toBe("interrupted");
      expect(reverted.diagnostic?.details?.locations).toContain(
        "/word/document.xml body: count",
      );
    });

    it("verifies a heading Word adds under its localized style ID", async () => {
      const host = install({ builtInStyleIds: { Heading2: "berschrift2" } });
      const original = host.ooxml();
      const snapshot = await captureRealisticSnapshot();
      const applied = await apply(
        planOf(
          snapshot,
          changeOf("inserts a heading after an anchor", snapshot),
        ),
        snapshot,
      );
      expect(applied.status, report(applied)).toBe("applied");
      expect(applied.outcome).toMatchObject({
        route: "in-place",
        tier: "block",
      });
      expect(host.ooxml()).toContain('<w:pStyle w:val="berschrift2"/>');
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
    });

    it("applies a custom style by its name on a localized Word", async () => {
      const host = install({ localizedStyleNames: true });
      const original = host.ooxml();
      const snapshot = await captureRealisticSnapshot();
      const applied = await apply(
        planOf(
          snapshot,
          changeOf("restyles a paragraph with a custom style", snapshot),
        ),
        snapshot,
      );
      expect(applied.status, report(applied)).toBe("applied");
      expect(applied.outcome?.route).toBe("in-place");
      expect(mutations(host.events)).toContain("mutation:style");
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
    });

    it("routes a built-in style without a portable name to the import", async () => {
      const xml = fixture((doc) => {
        const listBullet = new DOMParser().parseFromString(
          `<w:style xmlns:w="${W}" w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style>`,
          "application/xml",
        ).documentElement;
        doc
          .getElementsByTagNameNS(W, "styles")[0]
          .append(doc.importNode(listBullet, true));
      });
      const host = install({ localizedStyleNames: true }, xml);
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      const plan = planOf(snapshot, {
        replace: {
          [QUESTIONS]: [paragraph("b", QUESTIONS, { styleRef: "ListBullet" })],
        },
      });
      expect(
        classifyWordInPlacePlan(plan, snapshot, ALL_WORD_IN_PLACE_CAPABILITIES),
      ).toEqual({ fallback: "restyle" });
      const result = await apply(plan, snapshot);
      expect(result.status, report(result)).toBe("applied");
      expect(result.outcome?.route).toBe("import");
      expect(mutations(host.events)).toEqual([]);
      expect(debug).toHaveBeenLastCalledWith(
        "[erato] Word apply timings (ms)",
        expect.objectContaining({ routeReason: "restyle" }),
      );
    });

    it("joins an existing list when the new item follows a paragraph that is not in it", async () => {
      const host = install();
      const original = host.ooxml();
      const snapshot = await captureRealisticSnapshot();
      const applied = await apply(
        planOf(snapshot, {
          after: {
            [STATUS]: [
              listItem(
                snapshot,
                "first",
                "Agree the scope.",
                "Confirm the regions.",
              ),
            ],
          },
        }),
        snapshot,
      );
      expect(applied.status, report(applied)).toBe("applied");
      expect(mutations(host.events)).toContain("mutation:attachToList");
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
    });
  },
);

describe(
  "structural plans while their mechanisms await the native probe",
  { timeout: 60_000 },
  () => {
    it.each([
      ["inserts a list item that continues an existing list", "list"],
      ["deletes a list item", "not-invertible"],
      ["merges two list items into one", "not-invertible"],
      ["detaches a list item from its list", "list"],
    ])("%s through the import (%s)", async (name, reason) => {
      const host = install();
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      const snapshot = await captureRealisticSnapshot();
      const result = await apply(
        planOf(snapshot, changeOf(name, snapshot)),
        snapshot,
      );
      expect(result.status, report(result)).toBe("applied");
      expect(result.outcome).toMatchObject({
        route: "import",
        tier: "content",
      });
      expect(host.insert).toHaveBeenCalledOnce();
      expect(mutations(host.events)).toEqual([]);
      expect(debug).toHaveBeenLastCalledWith(
        "[erato] Word apply timings (ms)",
        expect.objectContaining({ route: "import", routeReason: reason }),
      );
    });
  },
);

describe(
  "structural edits Word PC's native probes confirmed (P5, P7, P8)",
  { timeout: 60_000 },
  () => {
    it.each([
      "inserts a heading after an anchor",
      "splits one paragraph into three",
      "reshapes a heading and paragraph into three blocks",
      "restyles a paragraph as Heading 2",
      "restyles a paragraph with a custom style",
    ])("%s in place and undoes it exactly", async (name) => {
      const host = install();
      const original = host.ooxml();
      const snapshot = await captureRealisticSnapshot();
      const applied = await apply(
        planOf(snapshot, changeOf(name, snapshot)),
        snapshot,
      );
      expect(applied.status, report(applied)).toBe("applied");
      expect(applied.outcome).toMatchObject({ route: "in-place" });
      expect(host.insert).not.toHaveBeenCalled();
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, report(reverted, "revert")).toBe("reverted");
      expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
    });
  },
);

describe("scoped body edits in place", { timeout: 60_000 }, () => {
  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  const context = {
    chatId: "chat",
    messageId: "message-A",
    toolCallId: "read",
  };
  async function scoped(
    target: Record<string, unknown>,
    edit: (s: WordAuthoringSnapshot) => Record<string, unknown>,
  ) {
    const snapshot = await captureRealisticSnapshot();
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    const resolve = (value: unknown): unknown =>
      typeof value === "string" && value.startsWith("@")
        ? refOf(snapshot, value.slice(1))
        : Array.isArray(value)
          ? value.map(resolve)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, resolve(v)]),
              )
            : value;
    const read = await session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        target: resolve(target),
      },
      context,
    );
    if (!read.ok) throw new Error(read.error);
    const submitted = await createWordDocumentSubmissionExecutor(session)(
      {
        snapshot: snapshot.token,
        readToken: (read.result as { readToken: string }).readToken,
        scoped_edit: resolve(edit(snapshot)),
      },
      { ...context, toolCallId: "edit" },
    );
    if (!submitted.ok) throw new Error(JSON.stringify(submitted));
    return {
      snapshot,
      plan: (submitted.result as { plan: WordDocumentPlan }).plan,
    };
  }

  const scopedCases: [
    string,
    Record<string, unknown>,
    (s: WordAuthoringSnapshot) => Record<string, unknown>,
    "in-place" | "moved",
  ][] = [
    [
      "replace",
      { ref: `@${QUESTIONS}` },
      () => ({
        body: [
          {
            operation: "replace",
            source: [`@${QUESTIONS}`],
            blocks: [paragraph("q", "Open questions, revised.")],
          },
        ],
      }),
      "in-place",
    ],
    [
      "replace as a heading",
      { ref: `@${QUESTIONS}` },
      () => ({
        body: [
          {
            operation: "replace",
            source: [`@${QUESTIONS}`],
            blocks: [{ id: "h", type: "heading", level: 2, text: "Questions" }],
          },
        ],
      }),
      "in-place",
    ],
    [
      "replace two items with one",
      { ref: `@${BUDGET}`, throughRef: `@${SUPPORT}` },
      (s) => ({
        body: [
          {
            operation: "replace",
            source: [`@${BUDGET}`, `@${SUPPORT}`],
            blocks: [listItem(s, "m", "Budget and support", BUDGET)],
          },
        ],
      }),
      "in-place",
    ],
    [
      "replace one paragraph with two",
      { ref: `@${QUESTIONS}` },
      () => ({
        body: [
          {
            operation: "replace",
            source: [`@${QUESTIONS}`],
            blocks: [
              paragraph("a", "Open questions:"),
              paragraph("b", "Who decides?"),
            ],
          },
        ],
      }),
      "in-place",
    ],
    [
      "delete",
      { ref: `@${SCHEDULE}` },
      () => ({
        body: [
          {
            operation: "delete",
            source: [`@${SCHEDULE}`],
            reason: "Requested removal",
          },
        ],
      }),
      "in-place",
    ],
    [
      "insert-before",
      { ref: `@${QUESTIONS}` },
      () => ({
        body: [
          {
            operation: "insert-before",
            anchor: `@${QUESTIONS}`,
            blocks: [paragraph("n", "Before the questions.")],
          },
        ],
      }),
      "in-place",
    ],
    [
      "insert-after",
      { ref: `@${REVIEW}` },
      (s) => ({
        body: [
          {
            operation: "insert-after",
            anchor: `@${REVIEW}`,
            blocks: [listItem(s, "n", "Report back.", REVIEW)],
          },
        ],
      }),
      "in-place",
    ],
    [
      "move-before",
      { refs: [`@${QUESTIONS}`, `@${STATUS}`] },
      () => ({
        body: [
          {
            operation: "move-before",
            source: [`@${QUESTIONS}`],
            anchor: `@${STATUS}`,
          },
        ],
      }),
      "moved",
    ],
    [
      "move-after",
      { refs: [`@${STATUS}`, `@${QUESTIONS}`] },
      () => ({
        body: [
          {
            operation: "move-after",
            source: [`@${STATUS}`],
            anchor: `@${QUESTIONS}`,
          },
        ],
      }),
      "moved",
    ],
  ];

  it.each(scopedCases)(
    "applies a scoped %s",
    async (_name, target, edit, expected) => {
      const host = install();
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      const { snapshot, plan } = await scoped(target, edit);
      const classified = classifyWordInPlacePlan(
        plan,
        snapshot,
        ALL_WORD_IN_PLACE_CAPABILITIES,
      );
      if ("ops" in classified)
        expect(sameWordInPlaceProgram(plan, snapshot, classified.ops)).toBe(
          true,
        );
      const expectedText = captureWordAuthoringSnapshot(
        compileWordDocumentPlan(plan, snapshot),
        "doc-A",
        "Off",
        true,
        "verify",
      ).blocks.map((b) => b.text);
      const result = await apply(plan, snapshot);
      expect(result.status, report(result)).toBe("applied");
      expect(
        captureWordAuthoringSnapshot(
          host.ooxml(),
          "doc-A",
          "Off",
          true,
          "verify",
        ).blocks.map((b) => b.text),
      ).toEqual(expectedText);
      if (expected === "in-place") {
        expect(classified).toHaveProperty("ops");
        expect(result.outcome?.route).toBe("in-place");
        expect(host.insert).not.toHaveBeenCalled();
      } else {
        expect(classified).toEqual({ fallback: "moved" });
        expect(result.outcome?.route).toBe("import");
        expect(debug).toHaveBeenLastCalledWith(
          "[erato] Word apply timings (ms)",
          expect.objectContaining({ routeReason: "moved" }),
        );
      }
    },
  );
});

describe("structural writes Word stops midway", { timeout: 30_000 }, () => {
  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  it("reports a rejected style batch and removes the inserted paragraph on Restore", async () => {
    const host = install();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = host.ooxml();
    const snapshot = await captureRealisticSnapshot();
    // insertParagraph, insertText, then the style change Word rejects.
    host.failAtCommand(3);
    const result = await apply(
      planOf(snapshot, changeOf("inserts a heading after an anchor", snapshot)),
      snapshot,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "write",
      reason: "host-error",
      details: { route: "in-place", partial: { applied: 1, untouched: 0 } },
    });
    expect(result.afterFingerprint).toMatch(/^word-scope-v1:/);
    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
  });

  it("classifies a batch rejected between regions and restores the written one", async () => {
    const host = install();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = host.ooxml();
    const snapshot = await captureRealisticSnapshot();
    // Regions run last to first: the split below the list is written, the deletion is rejected.
    const plan = planOf(snapshot, {
      ...changeOf("splits one paragraph into three", snapshot),
      delete: [SCHEDULE],
    });
    host.failAtCommand(11);
    const result = await apply(plan, snapshot);
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic?.details?.partial).toEqual({
      applied: 3,
      untouched: 1,
    });
    expect(host.ooxml()).toContain("Who owns the ");
    expect(host.ooxml()).toContain(SCHEDULE);
    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(bodySignatures(host.ooxml())).toEqual(bodySignatures(original));
  });

  it("refuses to restore over a later edit to an inserted paragraph", async () => {
    const host = install();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      planOf(snapshot, changeOf("inserts a heading after an anchor", snapshot)),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const inserted = captureWordAuthoringSnapshot(
      host.ooxml(),
      "doc-A",
      "Off",
      true,
      "verify",
    ).blocks.findIndex((b) => b.text === "Next steps");
    host.editParagraph(inserted, "Next steps, as the user wrote them.");
    host.events.length = 0;
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
    expect(host.ooxml()).toContain("Next steps, as the user wrote them.");
  });

  it("keeps the record of every structural change in the backup", async () => {
    install();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      planOf(snapshot, {
        ...changeOf("splits one paragraph into three", snapshot),
        delete: [SCHEDULE],
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    const record = decodeWordInPlaceBackup(applied.before!).inPlace!;
    expect(record.ops.map((op) => op.kind).sort()).toEqual([
      "delete",
      "insert",
      "insert",
      "text",
    ]);
    expect(record.regions).toHaveLength(2);
    expect(record.regions.every((region) => region.after)).toBe(true);
  });
});
