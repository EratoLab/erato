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
import { decodeWordInPlaceBackup } from "../wordDocumentPackage";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
import { wordParagraphStateIssue } from "../wordInPlaceExecutor";
import { resetWordInPlaceLatchForTests } from "../wordInPlaceSwitch";
import { wordInPlaceMismatchedParagraphs } from "../wordReviewLocation";
import { wordMismatchedPassages } from "../wordReviewState";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type {
  WordDocumentApplyResult,
  WordDocumentRevertResult,
} from "../wordApplyDocumentPlan";
import type { WordInPlaceCapabilities } from "../wordInPlaceCapabilities";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
} from "@erato/frontend/word-review";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const QUESTIONS = "Open questions follow.";
const HEADING = `${SENTINEL} quarterly brief`;

/** What Word for the web runs in place (ERMAIN-961): text, table cells and restyles. */
const WEB: WordInPlaceCapabilities = {
  ...(Object.fromEntries(
    Object.keys(ALL_WORD_IN_PLACE_CAPABILITIES).map((m) => [m, false]),
  ) as WordInPlaceCapabilities),
  text: true,
  cell: true,
  restyle: true,
};

/** Word for the web: Paragraph.getOoxml carries no w:pPr, so only the paragraph's properties show
 * its style. */
const install = (
  options: WordOoxmlHostOptions = {},
  xml = realisticWordPackageXml(),
) =>
  installWordOoxmlHost(xml, {
    profile: "word-web",
    paragraphOoxmlOmitsProperties: true,
    ...options,
  });

/** The realistic document as German Word saves it: localized IDs, canonical English names. */
const GERMAN: Record<string, string> = {
  Normal: "Standard",
  Heading1: "berschrift1",
  ListParagraph: "Listenabsatz",
};
const german = () =>
  editWordPackage(realisticWordPackageXml(), (doc) => {
    for (const style of Array.from(doc.getElementsByTagNameNS(W, "style"))) {
      const id = style.getAttributeNS(W, "styleId") ?? "";
      if (GERMAN[id]) style.setAttributeNS(W, "w:styleId", GERMAN[id]);
    }
    for (const name of ["pStyle", "basedOn", "next"])
      for (const ref of Array.from(doc.getElementsByTagNameNS(W, name))) {
        const id = ref.getAttributeNS(W, "val") ?? "";
        if (GERMAN[id]) ref.setAttributeNS(W, "w:val", GERMAN[id]);
      }
  });

/** The block as the open document's package has it. */
const block = (host: { ooxml: () => string }, prefix: string) =>
  captureWordAuthoringSnapshot(
    host.ooxml(),
    "doc-A",
    "Off",
    true,
    "verify",
  ).blocks.find((b) => b.text.startsWith(prefix))!;

function restyle(
  snapshot: WordAuthoringSnapshot,
  prefix: string,
  target: Omit<WordPlanBlock, "id" | "text">,
): WordDocumentPlan {
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: snapshot.blocks.map((b) =>
      b.text.startsWith(prefix)
        ? {
            kind: "replace",
            source: [b.ref],
            blocks: [{ id: "r", text: b.text, ...target } as WordPlanBlock],
          }
        : { kind: "keep", source: [b.ref] },
    ),
    deleted: [],
  };
}

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
const revert = (applied: WordDocumentApplyResult) =>
  revertWordDocumentPlan(applied.before!, applied.afterFingerprint!);
const mutations = (events: string[]) =>
  events.filter((e) => e.startsWith("mutation:"));

beforeEach(() => setWordInPlaceCapabilitiesForTests(WEB));
afterEach(() => {
  resetWordInPlaceLatchForTests();
  setWordInPlaceCapabilitiesForTests(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Revert of an in-place restyle where Paragraph.getOoxml shows no style", () => {
  it("restores the original style and reports reverted", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      restyle(snapshot, QUESTIONS, { type: "heading", level: 2 }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome?.route).toBe("in-place");
    expect(block(host, QUESTIONS)).toMatchObject({
      type: "heading",
      level: 2,
    });
    host.events.length = 0;
    const reverted = await revert(applied);
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(mutations(host.events)).toEqual(["mutation:styleBuiltIn"]);
    const restored = block(host, QUESTIONS);
    expect(restored.type).toBe("paragraph");
    expect(restored.styleRef).toBeUndefined();
    expect(host.insert).not.toHaveBeenCalled();
  });

  it("reports interrupted, not reverted, when the style does not change back", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      restyle(snapshot, QUESTIONS, { type: "heading", level: 2 }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    host.ignoreStyleWrites();
    const reverted = await revert(applied);
    expect(reverted.status).toBe("interrupted");
    expect(reverted.diagnostic).toMatchObject({
      stage: "restore",
      reason: "output-mismatch",
      details: {
        locations: [
          `/word/document.xml body block ${snapshot.blocks.findIndex((b) => b.text === QUESTIONS) + 1}: style`,
        ],
      },
    });
    expect(block(host, QUESTIONS)).toMatchObject({
      type: "heading",
      level: 2,
    });
  });

  it("writes nothing when the paragraph's style changed after the write", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      restyle(snapshot, QUESTIONS, { type: "heading", level: 2 }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    host.userEdit((ooxml) =>
      editWordPackage(ooxml, (doc) => {
        const text = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
          (t) => t.textContent === QUESTIONS,
        )!;
        const pStyle =
          text.parentElement!.parentElement!.getElementsByTagNameNS(
            W,
            "pStyle",
          )[0];
        pStyle.setAttributeNS(W, "w:val", "Heading1");
      }),
    );
    host.events.length = 0;
    const reverted = await revert(applied);
    expect(reverted.status).toBe("stale");
    expect(reverted.diagnostic).toMatchObject({
      stage: "preflight",
      reason: "source-changed",
    });
    expect(mutations(host.events)).toEqual([]);
    expect(block(host, QUESTIONS)).toMatchObject({
      type: "heading",
      level: 1,
    });
  });

  it("restores a custom style it replaced", async () => {
    const host = install(
      {},
      editWordPackage(realisticWordPackageXml(), (doc) => {
        const styles = doc.getElementsByTagNameNS(W, "styles")[0];
        styles.append(
          doc.importNode(
            new DOMParser().parseFromString(
              `<w:style xmlns:w="${W}" w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>`,
              "application/xml",
            ).documentElement,
            true,
          ),
        );
      }),
    );
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(
      restyle(snapshot, QUESTIONS, { type: "paragraph", styleRef: "Callout" }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(block(host, QUESTIONS).styleRef).toBe("Callout");
    const reverted = await revert(applied);
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(block(host, QUESTIONS).styleRef).toBeUndefined();
  });
});

describe("Revert of a list-level change where Paragraph.getOoxml shows no numbering", () => {
  const SCHEDULE = "Schedule the pilot.";
  /** "Review at month end." moved to level 1: a plan continues a list only at a level it has. */
  const twoLevels = () =>
    editWordPackage(realisticWordPackageXml(), (doc) => {
      const text = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
        (t) => t.textContent === "Review at month end.",
      )!;
      text
        .parentElement!.parentElement!.getElementsByTagNameNS(W, "ilvl")[0]
        .setAttributeNS(W, "w:val", "1");
    });

  it("moves the item back to its level and reports reverted", async () => {
    setWordInPlaceCapabilitiesForTests({ ...WEB, list: true });
    const host = install({}, twoLevels());
    const snapshot = await captureRealisticSnapshot();
    const source = snapshot.blocks.find((b) => b.text === SCHEDULE)!;
    const applied = await apply(
      restyle(snapshot, SCHEDULE, {
        type: "list-item",
        list: source.list,
        ordered: source.ordered,
        level: 1,
        styleRef: source.styleRef,
      }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome?.route).toBe("in-place");
    expect(block(host, SCHEDULE)).toMatchObject({ level: 1 });
    host.events.length = 0;
    const reverted = await revert(applied);
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(mutations(host.events)).toContain("mutation:attachToList");
    expect(block(host, SCHEDULE)).toMatchObject({
      type: "list-item",
      level: 0,
      list: source.list,
    });
  });
});

describe("tracked restyle where Paragraph.getOoxml shows no style", () => {
  it("rejects the formatting revision on Revert", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const host = install({ trackChanges: true });
    host.setTrackingMode("TrackAll");
    const snapshot = await captureRealisticSnapshot("message-A", "TrackAll");
    const applied = await apply(
      restyle(snapshot, QUESTIONS, { type: "heading", level: 2 }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(host.ooxml()).toContain("pPrChange");
    const reverted = await revert(applied);
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(block(host, QUESTIONS)).toMatchObject({ type: "paragraph" });
    expect(host.ooxml()).not.toContain("pPrChange");
  });
});

describe("Revert after an Apply that stopped between its text and style writes", () => {
  const NEW_TEXT = "Open questions, revised, follow.";
  const reworded = (snapshot: WordAuthoringSnapshot) => {
    const plan = restyle(snapshot, QUESTIONS, { type: "heading", level: 2 });
    plan.entries = plan.entries.map((entry) =>
      entry.kind === "replace"
        ? { ...entry, blocks: [{ ...entry.blocks[0], text: NEW_TEXT }] }
        : entry,
    );
    return plan;
  };

  it.each([
    ["Word for the web", { profile: "word-web" as const }, WEB],
    [
      "Word PC",
      {
        profile: "word-pc-16.0.20326" as const,
        paragraphOoxmlOmitsProperties: false,
      },
      ALL_WORD_IN_PLACE_CAPABILITIES,
    ],
  ])("puts the text back on %s", async (_host, options, caps) => {
    setWordInPlaceCapabilitiesForTests(caps);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let host = install(options);
    let snapshot = await captureRealisticSnapshot();
    host.events.length = 0;
    expect((await apply(reworded(snapshot), snapshot)).status).toBe("applied");
    const styleWrite =
      mutations(host.events).findIndex((e) => e === "mutation:styleBuiltIn") +
      1;
    expect(styleWrite).toBeGreaterThan(1);
    resetWordInPlaceLatchForTests();
    host = install(options);
    snapshot = await captureRealisticSnapshot();
    host.failAtCommand(styleWrite);
    const applied = await apply(reworded(snapshot), snapshot);
    expect(applied.status).toBe("interrupted");
    expect(block(host, NEW_TEXT)).toMatchObject({ type: "paragraph" });
    resetWordInPlaceLatchForTests();
    const reverted = await revert(applied);
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(block(host, QUESTIONS)).toMatchObject({ type: "paragraph" });
    expect(block(host, NEW_TEXT)).toBeUndefined();
  });
});

describe("in-place restyle verification", () => {
  it("reports a forward restyle whose style does not stick as unverified", async () => {
    const host = install();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    host.ignoreStyleWrites();
    const applied = await apply(
      restyle(snapshot, QUESTIONS, { type: "heading", level: 2 }),
      snapshot,
    );
    const at = `/word/document.xml body block ${snapshot.blocks.findIndex((b) => b.text === QUESTIONS) + 1}`;
    expect(applied.status).toBe("interrupted");
    expect(applied.diagnostic).toMatchObject({
      stage: "verify",
      reason: "output-mismatch",
      details: { locations: [`${at}: style`, `${at}: type`] },
    });
  });

  it("lists every unverified paragraph, from both checks, for the card to locate", async () => {
    const CLOSING = "Closing paragraph.";
    const host = install(
      { replaceDropsRunProperties: true },
      editWordPackage(realisticWordPackageXml(), (doc) => {
        const run = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
          (t) => t.textContent === CLOSING,
        )!.parentElement!;
        const props = doc.createElementNS(W, "w:rPr");
        const lang = doc.createElementNS(W, "w:lang");
        lang.setAttributeNS(W, "w:val", "en-GB");
        props.append(lang);
        run.prepend(props);
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = await captureRealisticSnapshot();
    const plan = restyle(snapshot, QUESTIONS, { type: "heading", level: 2 });
    plan.entries = plan.entries.map((entry) =>
      entry.kind === "keep" &&
      snapshot.blocks.find((b) => b.ref === entry.source[0])?.text === CLOSING
        ? {
            kind: "replace",
            source: entry.source,
            blocks: [
              {
                id: "c",
                type: "paragraph",
                text: "Bye.",
                runs: [{ text: "Bye.", language: "en-GB" }],
              },
            ],
          }
        : entry,
    );
    host.ignoreStyleWrites();
    const applied = await apply(plan, snapshot);
    expect(applied.status).toBe("interrupted");
    const record = decodeWordInPlaceBackup(applied.before!).inPlace!;
    expect(wordMismatchedPassages(applied.diagnostic)).toBe(2);
    expect(wordInPlaceMismatchedParagraphs(record)).toHaveLength(2);
  });

  it("accepts Normal written by the document's own ID for it, and restores the heading", async () => {
    const host = install(
      { explicitDefaultStyle: true, builtInStyleIds: GERMAN },
      german(),
    );
    const snapshot = await captureRealisticSnapshot();
    expect(block(host, HEADING).styleRef).toBe("berschrift1");
    const applied = await apply(
      restyle(snapshot, HEADING, { type: "paragraph" }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(block(host, HEADING)).toMatchObject({
      type: "paragraph",
      styleRef: "Standard",
    });
    const reverted = await revert(applied);
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(block(host, HEADING)).toMatchObject({
      type: "heading",
      level: 1,
      styleRef: "berschrift1",
    });
  });
});

describe("in-place heading restyle where the document's Heading2 is a custom style", () => {
  const CLOSING = "Closing paragraph.";
  const PC: WordOoxmlHostOptions = {
    profile: "word-pc-16.0.20326",
    paragraphOoxmlOmitsProperties: false,
    builtInStyleTakesId: true,
  };
  /** As base-pc.docx: ID Heading2, name "Heading2", w:customStyle. */
  const customHeading2 = () =>
    editWordPackage(realisticWordPackageXml(), (doc) => {
      doc
        .getElementsByTagNameNS(W, "styles")[0]
        .append(
          doc.importNode(
            new DOMParser().parseFromString(
              `<w:style xmlns:w="${W}" w:type="paragraph" w:customStyle="1" w:styleId="Heading2"><w:name w:val="Heading2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:color w:val="1F4E79"/></w:rPr></w:style>`,
              "application/xml",
            ).documentElement,
            true,
          ),
        );
      const closing = Array.from(doc.getElementsByTagNameNS(W, "t")).find(
        (t) => t.textContent === CLOSING,
      )!.parentElement!.parentElement!;
      const pPr = doc.createElementNS(W, "w:pPr");
      const pStyle = doc.createElementNS(W, "w:pStyle");
      pStyle.setAttributeNS(W, "w:val", "Heading2");
      pPr.append(pStyle);
      closing.prepend(pPr);
    });

  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  it("the host renames that style when Word's built-in heading is set", async () => {
    const host = install(PC, customHeading2());
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text");
      await context.sync();
      paragraphs.items.find((p) => p.text === QUESTIONS)!.styleBuiltIn =
        "Heading2";
      await context.sync();
    });
    expect(block(host, QUESTIONS).styleRef).toBe("Heading2");
    expect(block(host, CLOSING).styleRef).toBe("Heading20");
  });

  it("sets the style by name, leaves the other headings alone and reverts", async () => {
    const host = install(PC, customHeading2());
    const snapshot = await captureRealisticSnapshot();
    host.events.length = 0;
    const applied = await apply(
      restyle(snapshot, QUESTIONS, { type: "heading", level: 2 }),
      snapshot,
    );
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome?.route).toBe("in-place");
    expect(mutations(host.events)).toEqual(["mutation:style"]);
    expect(block(host, QUESTIONS)).toMatchObject({
      type: "heading",
      level: 2,
      styleRef: "Heading2",
    });
    expect(block(host, CLOSING).styleRef).toBe("Heading2");
    expect(host.ooxml()).not.toContain("Heading20");
    const reverted = await revert(applied);
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(block(host, QUESTIONS)).toMatchObject({ type: "paragraph" });
    expect(block(host, QUESTIONS).styleRef).toBeUndefined();
  });
});

describe("wordParagraphStateIssue", () => {
  const live = {
    isListItem: false,
    style: "heading 2",
    styleBuiltIn: "Heading2",
  };

  it("compares a built-in style by its locale-independent identifier", () => {
    expect(
      wordParagraphStateIssue(live, {
        type: "heading",
        level: 2,
        style: { builtIn: "Heading2" },
      }),
    ).toBeUndefined();
    expect(
      wordParagraphStateIssue(live, {
        type: "paragraph",
        style: { builtIn: "Normal" },
      }),
    ).toBe("style");
  });

  it("compares a custom style by name, ignoring case", () => {
    const custom = { ...live, style: "Callout Text", styleBuiltIn: "Other" };
    expect(
      wordParagraphStateIssue(custom, {
        type: "paragraph",
        style: { name: "callout text" },
      }),
    ).toBeUndefined();
    expect(
      wordParagraphStateIssue(custom, {
        type: "paragraph",
        style: { name: "Quote Text" },
      }),
    ).toBe("style");
  });

  it("checks list membership and, when known, the list", () => {
    const item = {
      isListItem: true,
      listId: 7,
      listLevel: 0,
      style: "List Paragraph",
      styleBuiltIn: "ListParagraph",
    };
    const target = {
      type: "list-item" as const,
      level: 0,
      style: { builtIn: "ListParagraph" },
    };
    expect(wordParagraphStateIssue(item, target, 7)).toBeUndefined();
    expect(wordParagraphStateIssue(item, target, 8)).toBe("list");
    expect(wordParagraphStateIssue({ ...item, listLevel: 1 }, target)).toBe(
      "list",
    );
    expect(
      wordParagraphStateIssue({ ...item, isListItem: false }, target),
    ).toBe("list");
    expect(
      wordParagraphStateIssue(item, {
        type: "paragraph",
        style: { builtIn: "ListParagraph" },
      }),
    ).toBe("list");
  });
});
