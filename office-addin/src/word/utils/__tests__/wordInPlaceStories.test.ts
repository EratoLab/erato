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
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
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
