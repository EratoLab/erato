import { afterEach, describe, expect, it, vi } from "vitest";

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
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import {
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
} from "../wordDocumentPackage";

import type { WordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";

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
