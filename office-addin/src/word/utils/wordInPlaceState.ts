import { wordPackageCounts } from "./wordFullDocumentComparison";
import { wordInPlaceTypedIssue } from "./wordInPlacePlan";
import {
  createNativeContentSignature,
  sameWordPreservedParts,
  wordMainBody,
} from "./wordNativeContent";
import { createWordXmlComparison } from "./wordXmlComparison";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { WordInPlaceMarks, WordInPlaceOp } from "./wordInPlacePlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const WORD_SCOPE_PREFIX = "word-scope-v1:";

function firstParagraph(doc: Document): Element {
  const body = wordMainBody(doc);
  const paragraph = body?.getElementsByTagNameNS(W, "p")[0];
  if (!paragraph) throw new Error("Word returned no paragraph content.");
  return paragraph;
}

/** Canonical content of the paragraph Paragraph.getOoxml returns: revision-session IDs and run
 * splits are ignored, every property and text is compared. */
export function wordParagraphSignature(paragraphOoxml: string): string {
  const doc = new DOMParser().parseFromString(
    paragraphOoxml,
    "application/xml",
  );
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("Word returned unreadable paragraph content.");
  return createWordXmlComparison(doc).signature(firstParagraph(doc));
}

/** b/i/u of the paragraph's first run: what insertText "Replace" keeps for the new text. */
export function wordFirstRunMarks(paragraphOoxml: string): WordInPlaceMarks {
  const doc = new DOMParser().parseFromString(
    paragraphOoxml,
    "application/xml",
  );
  const run = Array.from(firstParagraph(doc).children).find(
    (e) => e.namespaceURI === W && e.localName === "r",
  );
  const props = run
    ? Array.from(run.children).find(
        (e) => e.namespaceURI === W && e.localName === "rPr",
      )
    : undefined;
  const mark = (name: string) =>
    Array.from(props?.children ?? []).some(
      (e) =>
        e.namespaceURI === W &&
        e.localName === name &&
        (name === "u"
          ? e.getAttributeNS(W, "val") !== "none"
          : !["0", "false", "off"].includes(e.getAttributeNS(W, "val") ?? "")),
    );
  return { bold: mark("b"), italic: mark("i"), underline: mark("u") };
}

/** Post-write state of the touched paragraphs only; edits elsewhere never invalidate it. */
export function encodeWordScopeFingerprint(
  entries: readonly (readonly [id: string, signature: string])[],
): string {
  return WORD_SCOPE_PREFIX + JSON.stringify(entries);
}

export function isWordScopeFingerprint(value: string): boolean {
  return value.startsWith(WORD_SCOPE_PREFIX);
}

export function decodeWordScopeFingerprint(
  value: string,
): Map<string, string> | null {
  if (!isWordScopeFingerprint(value)) return null;
  try {
    const entries: unknown = JSON.parse(value.slice(WORD_SCOPE_PREFIX.length));
    if (
      !Array.isArray(entries) ||
      !entries.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((part) => typeof part === "string"),
      )
    )
      return null;
    return new Map(entries as [string, string][]);
  } catch {
    return null;
  }
}

/** Where a written block differs, as '/word/document.xml body block N: field'; never content.
 * `confined`: every difference lies in a paragraph the write replaced, so rewriting those
 * paragraphs undoes all of it. */
export type WordInPlaceVerification =
  | { ok: true }
  | { ok: false; locations: string[]; confined: boolean };

const MAX_LOCATIONS = 8;

/**
 * Block tier: untouched blocks keep their native signature, written paragraphs have exactly the
 * typed state the plan asked for, written table cells equal the compiled table, and nothing outside
 * the body changed beyond list-definition identity.
 */
export function verifyWordInPlaceOutput(
  ops: readonly WordInPlaceOp[],
  baseline: WordAuthoringSnapshot,
  compiled: WordAuthoringSnapshot,
  after: WordAuthoringSnapshot,
): WordInPlaceVerification {
  const locations: string[] = [];
  let confined = true;
  const at = (index: number, field: string, written = false) => {
    locations.push(`/word/document.xml body block ${index + 1}: ${field}`);
    if (!written) confined = false;
  };
  if (after.issue)
    return {
      ok: false,
      locations: ["/word/document.xml: issue"],
      confined: false,
    };
  if (after.blocks.length !== baseline.blocks.length)
    return {
      ok: false,
      locations: ["/word/document.xml body: count"],
      confined: false,
    };
  const before = createNativeContentSignature(baseline.ooxml);
  const actual = createNativeContentSignature(after.ooxml);
  const expected = createNativeContentSignature(compiled.ooxml);
  const byRef = new Map(ops.map((op) => [op.ref, op]));
  baseline.blocks.forEach((source, i) => {
    const op = byRef.get(source.ref);
    const written = after.blocks[i];
    if (!op) {
      if (before(source.xml) !== actual(written.xml)) at(i, "signature");
    } else if (op.kind === "cell") {
      // The table also holds cells the write never touched.
      const table = compiled.blocks[i];
      if (!table || expected(table.xml) !== actual(written.xml))
        at(i, "signature");
    } else {
      const issue = wordInPlaceTypedIssue(source, op, written);
      if (issue) at(i, issue, true);
    }
  });
  const counts = [baseline.ooxml, after.ooxml].map(wordPackageCounts);
  if (
    counts[0].parts - counts[0].webextensionParts !==
      counts[1].parts - counts[1].webextensionParts ||
    counts[0].customXmlItems !== counts[1].customXmlItems
  ) {
    locations.push("/: package");
    confined = false;
  } else if (!sameWordPreservedParts(baseline.ooxml, after.ooxml, "content")) {
    locations.push("/: preserved parts");
    confined = false;
  }
  return locations.length
    ? { ok: false, locations: locations.slice(0, MAX_LOCATIONS), confined }
    : { ok: true };
}
