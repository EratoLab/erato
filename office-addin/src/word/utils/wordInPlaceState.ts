import { wordPackageCounts } from "./wordFullDocumentComparison";
import { wordInPlaceExpected, wordInPlaceTypedIssue } from "./wordInPlacePlan";
import {
  createNativeContentSignature,
  sameWordPreservedParts,
  wordMainBody,
} from "./wordNativeContent";
import { createWordXmlComparison } from "./wordXmlComparison";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type {
  WordInPlaceMarks,
  WordInPlaceOp,
  WordInPlaceSlot,
} from "./wordInPlacePlan";

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

/** One paragraph inside a touched region after a write: its ID, its signature and the region. */
export type WordScopeEntry = readonly [
  id: string,
  signature: string,
  region: number,
];

/** Post-write state of the touched regions only; edits elsewhere never invalidate it. */
export function encodeWordScopeFingerprint(
  entries: readonly WordScopeEntry[],
): string {
  return WORD_SCOPE_PREFIX + JSON.stringify(entries);
}

export function isWordScopeFingerprint(value: string): boolean {
  return value.startsWith(WORD_SCOPE_PREFIX);
}

export function decodeWordScopeFingerprint(
  value: string,
): WordScopeEntry[] | null {
  if (!isWordScopeFingerprint(value)) return null;
  try {
    const entries: unknown = JSON.parse(value.slice(WORD_SCOPE_PREFIX.length));
    if (
      !Array.isArray(entries) ||
      !entries.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 3 &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "string" &&
          Number.isSafeInteger(entry[2]) &&
          (entry[2] as number) >= 0,
      )
    )
      return null;
    return entries as WordScopeEntry[];
  } catch {
    return null;
  }
}

/** Where a written block differs, as '/word/document.xml body block N: field'; never content.
 * `confined`: every difference lies in a paragraph the write rewrote in place, so rewriting those
 * paragraphs undoes all of it. */
export type WordInPlaceVerification =
  | { ok: true }
  | { ok: false; locations: string[]; confined: boolean };

const MAX_LOCATIONS = 8;

export interface WordInPlaceVerifyInput {
  /** The expected block sequence over the live document the write started from. */
  slots: readonly WordInPlaceSlot[];
  /** The live document the write started from; keep slots name its blocks. */
  base: WordAuthoringSnapshot;
  /** The captured snapshot the ops were derived from. */
  snapshot: WordAuthoringSnapshot;
  /** The dry-run compile, and where each op's block sits in it. */
  compiled: WordAuthoringSnapshot;
  compiledIndex: ReadonlyMap<WordInPlaceOp, number>;
  after: WordAuthoringSnapshot;
}

/**
 * Block tier: untouched blocks keep their native signature, written and inserted paragraphs have
 * exactly the typed state the plan asked for, written table cells equal the compiled table, and
 * nothing outside the body changed beyond list-definition identity.
 */
export function verifyWordInPlaceOutput({
  slots,
  base,
  snapshot,
  compiled,
  compiledIndex,
  after,
}: WordInPlaceVerifyInput): WordInPlaceVerification {
  const locations: string[] = [];
  const ops = slots.flatMap((slot) => (slot.kind === "op" ? [slot.op] : []));
  let confined = ops.every(
    (op) => op.kind === "cell" || (op.kind === "text" && !op.restyle),
  );
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
  if (after.blocks.length !== slots.length)
    return {
      ok: false,
      locations: ["/word/document.xml body: count"],
      confined: false,
    };
  const before = createNativeContentSignature(base.ooxml);
  const actual = createNativeContentSignature(after.ooxml);
  const expected = createNativeContentSignature(compiled.ooxml);
  const bases = new Map(base.blocks.map((b) => [b.ref, b]));
  slots.forEach((slot, i) => {
    const written = after.blocks[i];
    if (slot.kind === "keep") {
      const source = bases.get(slot.ref);
      if (!source || before(source.xml) !== actual(written.xml))
        at(i, "signature");
      return;
    }
    const { op } = slot;
    if (op.kind === "cell") {
      // The table also holds cells the write never touched.
      const table = compiled.blocks[compiledIndex.get(op) ?? -1];
      if (!table || expected(table.xml) !== actual(written.xml))
        at(i, "signature");
      return;
    }
    const issue = wordInPlaceTypedIssue(
      wordInPlaceExpected(op, snapshot),
      written,
      after.styles,
    );
    if (issue) at(i, issue, true);
  });
  const counts = [base.ooxml, after.ooxml].map(wordPackageCounts);
  if (
    counts[0].parts - counts[0].webextensionParts !==
      counts[1].parts - counts[1].webextensionParts ||
    counts[0].customXmlItems !== counts[1].customXmlItems
  ) {
    locations.push("/: package");
    confined = false;
  } else if (!sameWordPreservedParts(base.ooxml, after.ooxml, "content")) {
    locations.push("/: preserved parts");
    confined = false;
  }
  return locations.length
    ? { ok: false, locations: locations.slice(0, MAX_LOCATIONS), confined }
    : { ok: true };
}
