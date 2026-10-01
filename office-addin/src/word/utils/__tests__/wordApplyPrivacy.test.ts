import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  SENTINEL,
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import {
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
} from "../wordDocumentPackage";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  setWordInPlaceCapabilitiesForTests,
} from "../wordInPlaceCapabilities";
import { resetWordInPlaceLatchForTests } from "../wordInPlaceSwitch";
import { predictWordBodyParagraphs } from "../wordLiveParagraphs";

import type { WordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import type {
  WordDocumentApplyResult,
  WordDocumentRevertResult,
} from "../wordApplyDocumentPlan";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** The values firstDivergence may print; anything else must be masked. */
const SHOWN =
  /^(-?\d{1,9}|[0-9A-Fa-f]{8}|auto|exact|atLeast|true|false|on|off|0|1|…|none)$/;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const changeCommentAuthor = (bytes: Uint8Array) =>
  wordDocumentOoxmlToFile(
    editWordPackage(wordDocumentFileToOoxml(bytes), (doc) =>
      doc
        .getElementsByTagNameNS(W, "comment")[0]
        .setAttributeNS(W, "w:author", `${SENTINEL} Someone else`),
    ),
  );
const changeHeaderText = (bytes: Uint8Array) =>
  wordDocumentOoxmlToFile(
    editWordPackage(wordDocumentFileToOoxml(bytes), (doc) => {
      const header = Array.from(
        doc.getElementsByTagNameNS(W, "hdr"),
      )[0].getElementsByTagNameNS(W, "t")[0];
      header.textContent = `${SENTINEL} rewritten header`;
    }),
  );

const failures: [
  string,
  (host: WordOoxmlHost) => void,
  { status: string; reason: string },
][] = [
  [
    "stale",
    (host) =>
      host.userEdit((xml) =>
        xml.replace("Closing paragraph.", `Closing ${SENTINEL} edit.`),
      ),
    { status: "stale", reason: "source-changed" },
  ],
  [
    "package-growth",
    (host) =>
      host.transform((bytes) =>
        wordDocumentOoxmlToFile(
          editWordPackage(wordDocumentFileToOoxml(bytes), (doc) => {
            const custom = Array.from(
              doc.getElementsByTagNameNS(
                "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties",
                "Properties",
              ),
            )[0];
            const copy = custom.lastElementChild!.cloneNode(true) as Element;
            copy.setAttribute("pid", "6");
            custom.append(copy);
          }),
        ),
      ),
    { status: "interrupted", reason: "package-growth" },
  ],
  [
    "output-mismatch (attribute)",
    (host) => host.transform(changeCommentAuthor),
    { status: "interrupted", reason: "output-mismatch" },
  ],
  [
    "output-mismatch (text)",
    (host) => host.transform(changeHeaderText),
    { status: "interrupted", reason: "output-mismatch" },
  ],
  [
    "host-error",
    (host) => host.failAfterWrite(`Word quoted "${SENTINEL}" in this error`),
    { status: "interrupted", reason: "host-error" },
  ],
];

describe("apply diagnostics privacy", { timeout: 30_000 }, () => {
  // Import failure paths; the in-place ones are covered below.
  beforeEach(() => {
    window.WORD_FORCE_IMPORT_APPLY = true;
  });
  afterEach(() => {
    delete window.WORD_FORCE_IMPORT_APPLY;
  });
  it.each(failures)(
    "keeps document content out of the %s report and logs",
    async (_name, fault, expected) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const host = installWordOoxmlHost(realisticWordPackageXml(), {
        profile: "word-pc-16.0.20326",
      });
      const snapshot = await captureRealisticSnapshot();
      fault(host);
      const result = await applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`)),
        snapshot,
        "message-A",
      );
      expect(result.status).toBe(expected.status);
      expect(result.diagnostic?.reason).toBe(expected.reason);
      const report = renderWordDiagnosticReport(
        "apply",
        result.status,
        result.diagnostic,
      );
      expect(report).not.toContain(SENTINEL);
      expect(JSON.stringify(result.diagnostic)).not.toContain(SENTINEL);
      for (const [, before, after] of report.matchAll(/ (\S+) → ([^,)\s]+)/g)) {
        expect(before).toMatch(SHOWN);
        expect(after).toMatch(SHOWN);
      }
      expect(warn).toHaveBeenCalled();
      for (const call of warn.mock.calls)
        for (const arg of call)
          expect(
            typeof arg === "string" ? arg : JSON.stringify(arg),
          ).not.toContain(SENTINEL);
    },
  );

  it("masks attribute values in the first-divergence locator", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = installWordOoxmlHost(realisticWordPackageXml());
    const snapshot = await captureRealisticSnapshot();
    host.transform(changeCommentAuthor);
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: v2.")),
      snapshot,
      "message-A",
    );
    const report = renderWordDiagnosticReport(
      "apply",
      result.status,
      result.diagnostic,
    );
    expect(report).toMatch(
      /^Where: \/word\/comments\.xml: .*attributes differ \(w:author … → …\)/m,
    );
  });
});

/** The status paragraph carries the sentinel; a fresh capture sees it after every step. */
const statusIndex = (host: WordOoxmlHost) =>
  predictWordBodyParagraphs(host.ooxml()).findIndex((p) =>
    p.text?.startsWith("Status"),
  );
/** The status paragraph with an en-GB run, which a Replace that drops run properties loses. */
async function unverifiedStatusWrite(host: WordOoxmlHost) {
  host.userEdit((xml) =>
    xml.replace(
      `<w:r><w:t xml:space="preserve">Status:`,
      `<w:r><w:rPr><w:lang w:val="en-GB"/></w:rPr><w:t xml:space="preserve">Status:`,
    ),
  );
  const snapshot = await captureRealisticSnapshot();
  const plan = statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`);
  const entry = plan.entries[1];
  if (entry.kind !== "replace") throw new Error("Expected a rewrite.");
  entry.blocks[0].runs = [
    { text: `Status: ${SENTINEL} v2.`, language: "en-GB" },
  ];
  return applyWordDocumentPlan(JSON.stringify(plan), snapshot, "message-A");
}

/** Insert a list item carrying the sentinel right after the status paragraph, which is not in the list. */
function sentinelListItem(snapshot: WordAuthoringSnapshot): WordDocumentPlan {
  setWordInPlaceCapabilitiesForTests(ALL_WORD_IN_PLACE_CAPABILITIES);
  const plan = statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`);
  const at = plan.entries.findIndex((entry) => entry.kind === "replace");
  plan.entries.splice(at + 1, 0, {
    kind: "insert",
    blocks: [
      {
        id: "item",
        type: "list-item",
        text: `${SENTINEL} item`,
        list: "existing-1",
        level: 0,
        ordered: true,
        styleRef: "ListParagraph",
      },
    ],
  });
  return plan;
}

const inPlaceFailures: [
  string,
  (
    host: WordOoxmlHost,
  ) => Promise<WordDocumentApplyResult | WordDocumentRevertResult>,
  { status: string; reason: string; route?: string },
][] = [
  [
    "stale paragraph read",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      host.editParagraph(
        statusIndex(host),
        `Status: ${SENTINEL} typed meanwhile.`,
        "after-capture",
      );
      return applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`)),
        snapshot,
        "message-A",
      );
    },
    { status: "stale", reason: "source-changed" },
  ],
  [
    "rejected batch",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      host.failAtCommand(1, `Word quoted "${SENTINEL}" in this error`);
      return applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`)),
        snapshot,
        "message-A",
      );
    },
    { status: "interrupted", reason: "host-error" },
  ],
  [
    "unexpected write",
    unverifiedStatusWrite,
    { status: "interrupted", reason: "output-mismatch" },
  ],
  [
    "Restore after an unexpected write, around a later edit",
    async (host) => {
      const applied = await unverifiedStatusWrite(host);
      host.editParagraph(
        predictWordBodyParagraphs(host.ooxml()).findIndex(
          (p) => p.text === "Open questions follow.",
        ),
        `${SENTINEL} typed later.`,
      );
      return revertWordDocumentPlan(applied.before!, applied.afterFingerprint!);
    },
    { status: "interrupted", reason: "output-mismatch" },
  ],
  [
    "in-place read failure before an import failure",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      host.failParagraphOoxml(`Word quoted "${SENTINEL}" in this error`);
      host.failImport();
      return applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`)),
        snapshot,
        "message-A",
      );
    },
    { status: "interrupted", reason: "host-error", route: "import" },
  ],
  [
    "revert over a later edit",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      const applied = await applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`)),
        snapshot,
        "message-A",
      );
      host.editParagraph(statusIndex(host), `Status: ${SENTINEL} by hand.`);
      return revertWordDocumentPlan(applied.before!, applied.afterFingerprint!);
    },
    { status: "stale", reason: "source-changed" },
  ],
  [
    "rejected revert",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      const applied = await applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`)),
        snapshot,
        "message-A",
      );
      host.failAtCommand(1, `Word quoted "${SENTINEL}" while reverting`);
      return revertWordDocumentPlan(applied.before!, applied.afterFingerprint!);
    },
    { status: "interrupted", reason: "host-error" },
  ],
  [
    "scope check after an edit to the target",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      host.editParagraph(statusIndex(host), `Status: ${SENTINEL} by hand.`);
      return applyWordDocumentPlan(
        JSON.stringify(sentinelListItem(snapshot)),
        snapshot,
        "message-A",
      );
    },
    { status: "stale", reason: "source-changed" },
  ],
  [
    "structural write that joins a new list instance",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      host.editParagraph(
        predictWordBodyParagraphs(host.ooxml()).findIndex(
          (p) => p.text === "Closing paragraph.",
        ),
        `${SENTINEL} typed elsewhere.`,
      );
      return applyWordDocumentPlan(
        JSON.stringify(sentinelListItem(snapshot)),
        snapshot,
        "message-A",
      );
    },
    { status: "interrupted", reason: "output-mismatch" },
  ],
  [
    "rejected structural batch",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      host.failAtCommand(4, `Word quoted "${SENTINEL}" in this error`);
      return applyWordDocumentPlan(
        JSON.stringify(sentinelListItem(snapshot)),
        snapshot,
        "message-A",
      );
    },
    { status: "interrupted", reason: "host-error" },
  ],
  [
    "Restore of a structural write over a later edit",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      const applied = await applyWordDocumentPlan(
        JSON.stringify(sentinelListItem(snapshot)),
        snapshot,
        "message-A",
      );
      host.editParagraph(statusIndex(host) + 1, `${SENTINEL} by hand.`);
      return revertWordDocumentPlan(applied.before!, applied.afterFingerprint!);
    },
    { status: "stale", reason: "source-changed" },
  ],
  [
    "Restore that does not verify",
    async (host) => {
      const snapshot = await captureRealisticSnapshot();
      const applied = await applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, `Status: ${SENTINEL} v2.`)),
        snapshot,
        "message-A",
      );
      host.setReplaceFault("edits-next");
      return revertWordDocumentPlan(applied.before!, applied.afterFingerprint!);
    },
    { status: "interrupted", reason: "output-mismatch" },
  ],
];

describe("in-place diagnostics privacy", { timeout: 30_000 }, () => {
  afterEach(() => {
    resetWordInPlaceLatchForTests();
    setWordInPlaceCapabilitiesForTests(undefined);
  });

  it.each(inPlaceFailures)(
    "keeps document content, paragraph IDs and scope fingerprints out of the %s report and logs",
    async (name, fail, expected) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const host = installWordOoxmlHost(realisticWordPackageXml(), {
        profile: "word-pc-16.0.20326",
        replaceDropsRunProperties: name.includes("unexpected write"),
        attachToListNewNum: name.includes("new list instance"),
      });
      const result = await fail(host);
      expect(result.status).toBe(expected.status);
      expect(result.diagnostic?.reason).toBe(expected.reason);
      expect(result.diagnostic?.details?.route).toBe(
        expected.route ?? "in-place",
      );
      const report = renderWordDiagnosticReport(
        "apply",
        result.status,
        result.diagnostic,
      );
      const forbidden = [SENTINEL, "word-scope-v1:", ...host.paragraphIds()];
      expect(warn).toHaveBeenCalled();
      const logged = warn.mock.calls
        .flat()
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)));
      for (const text of [report, JSON.stringify(result.diagnostic), ...logged])
        for (const secret of forbidden) expect(text).not.toContain(secret);
    },
  );
});
