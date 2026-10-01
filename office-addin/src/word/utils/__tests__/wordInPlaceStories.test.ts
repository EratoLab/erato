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
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
import { applyWordPlanInPlace } from "../wordInPlaceExecutor";
import { classifyWordInPlacePlan } from "../wordInPlacePlan";
import { resetWordInPlaceLatchForTests } from "../wordInPlaceSwitch";
import { createWordXmlComparison } from "../wordXmlComparison";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type {
  WordDocumentApplyResult,
  WordDocumentRevertResult,
} from "../wordApplyDocumentPlan";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
} from "../wordDocumentPlan";
import type { WordStoryChange } from "../wordStories";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEADER = `${SENTINEL} header`;

function install(
  options: WordOoxmlHostOptions = {},
  xml = realisticWordPackageXml(),
) {
  return installWordOoxmlHost(xml, {
    profile: "word-pc-16.0.20326",
    ...options,
  });
}

/** Keep the body and upsert stories. */
function storyPlan(
  snapshot: WordAuthoringSnapshot,
  stories: WordStoryChange[],
): WordDocumentPlan {
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: [{ kind: "keep", source: snapshot.blocks.map((b) => b.ref) }],
    deleted: [],
    stories,
  };
}
const header = (...blocks: Partial<WordPlanBlock>[]): WordStoryChange => ({
  kind: "upsert",
  type: "header",
  id: "header1",
  blocks: blocks.map(
    (block, i) =>
      ({ id: `h${i}`, type: "paragraph", ...block }) as WordPlanBlock,
  ),
});
const rewritten = header({
  text: "Quarterly brief, revised",
  runs: [{ text: "Quarterly brief", bold: true }, { text: ", revised" }],
});

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
const partSignatures = (ooxml: string) =>
  createWordXmlComparison(
    new DOMParser().parseFromString(ooxml, "application/xml"),
  ).partFingerprints();
const headerXml = (ooxml: string) => {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  return new XMLSerializer().serializeToString(
    doc.getElementsByTagNameNS(W, "hdr")[0],
  );
};
const compiledOf = (plan: WordDocumentPlan, snapshot: WordAuthoringSnapshot) =>
  captureWordAuthoringSnapshot(
    compileWordDocumentPlan(plan, snapshot),
    snapshot.identity,
    "Off",
    true,
    "verify",
  );

/** A second section ending after the first paragraph, using `firstSection` header references. */
function twoSections(firstSection: string, finalHasHeader: boolean): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const final = Array.from(doc.getElementsByTagNameNS(W, "sectPr")).at(-1)!;
    if (!finalHasHeader)
      Array.from(final.children)
        .filter((e) => e.localName === "headerReference")
        .forEach((e) => e.remove());
    const paragraph = doc.getElementsByTagNameNS(W, "p")[0];
    const props = new DOMParser().parseFromString(
      `<w:pPr xmlns:w="${W}" xmlns:r="${R}"><w:pStyle w:val="Heading1"/><w:sectPr>${firstSection}<w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr>`,
      "application/xml",
    ).documentElement;
    paragraph.querySelector("pPr")?.remove();
    paragraph.prepend(doc.importNode(props, true));
  });
}
const DEFAULT_HEADER = `<w:headerReference xmlns:w="${W}" xmlns:r="${R}" w:type="default" r:id="rIdHeader1"/>`;
const SECOND_LINE = `${SENTINEL} second header line`;
/** The header with a second paragraph after its first. */
const twoLineHeader = () =>
  editWordPackage(realisticWordPackageXml(), (doc) => {
    const header = doc.getElementsByTagNameNS(W, "hdr")[0];
    const line = header
      .getElementsByTagNameNS(W, "p")[0]
      .cloneNode(true) as Element;
    line.getElementsByTagNameNS(W, "t")[0].textContent = SECOND_LINE;
    header.append(line);
  });
const keptLine = { text: SECOND_LINE };
const EARLIER = "Earlier Reviewer";
/** The header run with an earlier reviewer's pending removal of bold. */
const pendingFormatHeader = () =>
  realisticWordPackageXml().replace(
    `<w:r><w:t xml:space="preserve">${HEADER}</w:t>`,
    `<w:r><w:rPr><w:rPrChange w:id="90" w:author="${EARLIER}" w:date="2026-09-01T00:00:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t xml:space="preserve">${HEADER}</w:t>`,
  );

afterEach(() => {
  resetWordInPlaceLatchForTests();
  setWordInPlaceCapabilitiesForTests(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("header and footer text in place", { timeout: 60_000 }, () => {
  beforeEach(() =>
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES),
  );

  it("rewrites a header paragraph without importing and restores it exactly", async () => {
    const host = install();
    const original = host.ooxml();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(storyPlan(snapshot, [rewritten]), snapshot);
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome).toMatchObject({
      route: "in-place",
      tier: "block",
      ops: 1,
    });
    expect(host.insert).not.toHaveBeenCalled();
    const written = headerXml(host.ooxml());
    expect(written).toContain("Quarterly brief");
    expect(written).toContain("<w:b/>");
    const before = partSignatures(original);
    const after = partSignatures(host.ooxml());
    expect(
      [...before.keys()].filter((part) => before.get(part) !== after.get(part)),
    ).toEqual(["/word/header1.xml"]);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(host.insert).not.toHaveBeenCalled();
    expect(partSignatures(host.ooxml())).toEqual(before);
  });

  it("rewrites a footer together with a body paragraph", async () => {
    const host = install();
    const original = partSignatures(host.ooxml());
    const snapshot = await captureRealisticSnapshot();
    const status = snapshot.blocks.find((b) => b.text.startsWith("Status"))!;
    const plan: WordDocumentPlan = {
      ...storyPlan(snapshot, [
        {
          kind: "upsert",
          type: "footer",
          id: "footer1",
          blocks: [{ id: "f", type: "paragraph", text: "Internal only" }],
        },
      ]),
      entries: snapshot.blocks.map((b) =>
        b === status
          ? {
              kind: "replace",
              source: [b.ref],
              blocks: [{ id: "s", type: "paragraph", text: "Status: green." }],
            }
          : { kind: "keep", source: [b.ref] },
      ),
    };
    const applied = await apply(plan, snapshot);
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome).toMatchObject({ route: "in-place", ops: 2 });
    expect(host.ooxml()).toContain("Internal only");
    expect(host.ooxml()).toContain("Status: green.");
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(partSignatures(host.ooxml())).toEqual(original);
  });

  it("writes header changes as tracked revisions and rejects them on Restore", async () => {
    const host = install({ trackChanges: true });
    host.setTrackingMode("TrackAll");
    const original = partSignatures(host.ooxml());
    const snapshot = await captureRealisticSnapshot("message-A", "TrackAll");
    const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
    const applied = await apply(storyPlan(snapshot, [rewritten]), snapshot);
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome).toMatchObject({ route: "in-place", tracked: true });
    const written = headerXml(host.ooxml());
    expect(written).toContain("<w:ins ");
    expect(written).toContain("<w:del ");
    expect(host.ooxml().split("<w:ins ").length - 1).toBe(
      written.split("<w:ins ").length - 1,
    );
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(partSignatures(host.ooxml())).toEqual(original);
    expect(setter).not.toHaveBeenCalled();
  });

  it("does not verify a header write that also changed the line after it", async () => {
    const host = install({}, twoLineHeader());
    const original = headerXml(host.ooxml());
    const snapshot = await captureRealisticSnapshot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    host.setReplaceFault("edits-next");
    const applied = await apply(
      storyPlan(snapshot, [
        header({ text: `${SENTINEL} brief, revised` }, keptLine),
      ]),
      snapshot,
    );
    expect(applied.status).toBe("interrupted");
    expect(applied.diagnostic).toMatchObject({
      stage: "verify",
      reason: "output-mismatch",
      details: { route: "in-place", verifyTier: "block" },
    });
    expect(applied.diagnostic?.details?.locations).toEqual([
      "/word/header1.xml: paragraph 2 signature",
    ]);
    const text = [report(applied), ...warn.mock.calls.flat().map(String)].join(
      "\n",
    );
    expect(text).not.toContain(SENTINEL);
    host.setReplaceFault(undefined);
    // The exact package restore: the write did not verify.
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(reverted.outcome?.route).toBe("import");
    expect(headerXml(host.ooxml())).toBe(original);
  });

  it("does not verify a header line written with the wrong marks", async () => {
    const host = install();
    await captureRealisticSnapshot();
    host.userEdit((xml) =>
      xml.replace(
        `<w:t xml:space="preserve">${HEADER}</w:t>`,
        `<w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${HEADER}</w:t>`,
      ),
    );
    const snapshot = await captureRealisticSnapshot();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.setReplaceFault("drops-rpr");
    const applied = await apply(
      storyPlan(snapshot, [
        header({
          text: `${SENTINEL} brief`,
          runs: [{ text: `${SENTINEL} brief`, bold: true }],
        }),
      ]),
      snapshot,
    );
    expect(applied.status).toBe("interrupted");
    expect(applied.diagnostic?.details?.locations).toEqual([
      "/word/header1.xml: paragraph 1 runs",
    ]);
    expect(report(applied)).not.toContain(SENTINEL);
  });

  it("restores a tracked header write Word stopped halfway, by rejecting it", async () => {
    const host = install({ trackChanges: true });
    host.setTrackingMode("TrackAll");
    const original = partSignatures(host.ooxml());
    const snapshot = await captureRealisticSnapshot("message-A", "TrackAll");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.failAtCommand(2);
    const applied = await apply(storyPlan(snapshot, [rewritten]), snapshot);
    expect(applied.status).toBe("interrupted");
    expect(headerXml(host.ooxml())).toContain("<w:ins ");
    expect(applied.afterFingerprint).toMatch(/^word-scope-v1:/);
    const record = decodeWordInPlaceBackup(applied.before!).inPlace!;
    expect(record.regions.at(-1)?.after).toHaveLength(1);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(host.insert).not.toHaveBeenCalled();
    expect(partSignatures(host.ooxml())).toEqual(original);
  });

  it("blocks a tracked header write over another reviewer's formatting revision", async () => {
    const host = install({ trackChanges: true }, pendingFormatHeader());
    host.setTrackingMode("TrackAll");
    const original = headerXml(host.ooxml());
    const snapshot = await captureRealisticSnapshot("message-A", "TrackAll");
    const plan = storyPlan(snapshot, [header({ text: `${HEADER}, revised` })]);
    expect(
      classifyWordInPlacePlan(
        plan,
        snapshot,
        ALL_WORD_IN_PLACE_CAPABILITIES,
        compiledOf(plan, snapshot),
      ),
    ).toEqual({ fallback: "stories" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.events.length = 0;
    const applied = await apply(plan, snapshot);
    expect(applied.status).toBe("blocked");
    expect(applied.diagnostic).toMatchObject({
      reason: "tracking",
      details: { fallbackReasons: ["stories"] },
    });
    expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
    expect(host.insert).not.toHaveBeenCalled();
    expect(headerXml(host.ooxml())).toBe(original);
    expect(original).toContain(`w:author="${EARLIER}"`);
    expect(snapshot.used).toBe(false);
  });

  it("refuses a tracked write to a target that already holds revisions, even when admitted", async () => {
    const host = install({ trackChanges: true }, pendingFormatHeader());
    host.setTrackingMode("TrackAll");
    const original = headerXml(host.ooxml());
    const snapshot = await captureRealisticSnapshot("message-A", "TrackAll");
    const plan = storyPlan(snapshot, [header({ text: `${HEADER}, revised` })]);
    const plain = { bold: false, italic: false, underline: false };
    host.events.length = 0;
    // Mis-admitted on purpose: the classifier sends this to the import.
    const result = await applyWordPlanInPlace({
      snapshot,
      compiled: compiledOf(plan, snapshot),
      ops: [
        {
          kind: "text",
          ref: "header1",
          paragraph: 0,
          runs: [{ text: `${HEADER}, revised`, ...plain }],
          original: [{ text: HEADER, ...plain }],
          story: {
            kind: "header",
            part: "/word/header1.xml",
            section: 0,
            type: "Primary",
          },
        },
      ],
      progress: trackWordApply("plan"),
      observePackage: async () => undefined,
    });
    expect(result).toEqual({
      fallback: "tracking",
      details: { fallbackReasons: ["native-target"] },
    });
    expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
    expect(headerXml(host.ooxml())).toBe(original);
  });

  it("refuses a header that changed since the capture", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    host.userEdit((xml) => xml.replace(HEADER, "Edited header"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.events.length = 0;
    const applied = await apply(storyPlan(snapshot, [rewritten]), snapshot);
    expect(applied.status).toBe("stale");
    expect(applied.diagnostic?.details?.locations).toEqual([
      "/word/header1.xml paragraph 1: changed",
    ]);
    expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
    expect(report(applied)).not.toContain("Edited header");
  });

  it("refuses Restore after the header was edited again, and restores around body edits", async () => {
    const host = install();
    const snapshot = await captureRealisticSnapshot();
    const applied = await apply(storyPlan(snapshot, [rewritten]), snapshot);
    expect(applied.status, report(applied)).toBe("applied");
    host.userEdit((xml) =>
      xml.replace("Closing paragraph.", "Closing paragraph, edited."),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    host.userEdit((xml) => xml.replace(", revised", ", revised twice"));
    const stale = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(stale.status).toBe("stale");
    expect(stale.diagnostic?.details?.locations).toEqual([
      "/word/header1.xml paragraph 1: changed",
    ]);
    host.userEdit((xml) => xml.replace(", revised twice", ", revised"));
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status, report(reverted, "revert")).toBe("reverted");
    expect(host.ooxml()).toContain(HEADER);
    expect(host.ooxml()).toContain("Closing paragraph, edited.");
  });
});

describe("story changes that need the import", { timeout: 60_000 }, () => {
  const classify = (
    snapshot: WordAuthoringSnapshot,
    plan: WordDocumentPlan,
    caps = ALL_WORD_IN_PLACE_CAPABILITIES,
  ) =>
    classifyWordInPlacePlan(plan, snapshot, caps, compiledOf(plan, snapshot));

  it("routes shared and inherited headers, new headers and changed paragraph counts to the import", async () => {
    install({}, twoSections(DEFAULT_HEADER, true));
    const shared = await captureRealisticSnapshot();
    expect(classify(shared, storyPlan(shared, [rewritten]))).toEqual({
      fallback: "stories",
    });
    vi.unstubAllGlobals();
    install({}, twoSections(DEFAULT_HEADER, false));
    const inherited = await captureRealisticSnapshot();
    expect(classify(inherited, storyPlan(inherited, [rewritten]))).toEqual({
      fallback: "stories",
    });
    vi.unstubAllGlobals();
    install();
    const snapshot = await captureRealisticSnapshot();
    expect("ops" in classify(snapshot, storyPlan(snapshot, [rewritten]))).toBe(
      true,
    );
    expect(
      classify(
        snapshot,
        storyPlan(snapshot, [header({ text: "One" }, { text: "Two" })]),
      ),
    ).toEqual({ fallback: "stories" });
    expect(
      classifyWordInPlacePlan(
        storyPlan(snapshot, [{ ...rewritten, id: "headerErato1" }]),
        snapshot,
        ALL_WORD_IN_PLACE_CAPABILITIES,
        snapshot,
      ),
    ).toEqual({ fallback: "stories" });
    expect(
      classify(
        snapshot,
        storyPlan(snapshot, [header({ text: "Styled", styleRef: "Heading1" })]),
      ),
    ).toEqual({ fallback: "stories" });
    expect(
      classify(snapshot, storyPlan(snapshot, [rewritten]), {
        ...ALL_WORD_IN_PLACE_CAPABILITIES,
        storyText: false,
      }),
    ).toEqual({ fallback: "story-text" });
  });

  it("imports a shared header with routeReason stories", async () => {
    setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
    const host = install({}, twoSections(DEFAULT_HEADER, true));
    const snapshot = await captureRealisticSnapshot();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const applied = await apply(storyPlan(snapshot, [rewritten]), snapshot);
    expect(applied.status, report(applied)).toBe("applied");
    expect(applied.outcome?.route).toBe("import");
    expect(host.insert).toHaveBeenCalledOnce();
    expect(debug).toHaveBeenLastCalledWith(
      "[erato] Word apply timings (ms)",
      expect.objectContaining({ routeReason: "stories" }),
    );
  });
});
