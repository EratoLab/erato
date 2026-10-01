import { captureWordAuthoringSnapshot } from "./wordDocumentXml";
import { wordPackageCounts } from "./wordFullDocumentComparison";
import { wordInPlaceExpected, wordInPlaceTypedIssue } from "./wordInPlacePlan";
import {
  verifyWordStoryOutput,
  wordStoryParagraphElements,
  wordStoryRoot,
} from "./wordInPlaceStories";
import { wordBodyParagraphElements } from "./wordLiveParagraphs";
import {
  createNativeContentSignature,
  sameWordPreservedParts,
  wordMainBody,
} from "./wordNativeContent";
import {
  acceptWordRevisions,
  rejectWordRevisions,
  wordRevisionsOutside,
} from "./wordRevisionViews";
import { createWordXmlComparison } from "./wordXmlComparison";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type {
  WordInPlaceMarks,
  WordInPlaceOp,
  WordInPlaceSlot,
} from "./wordInPlacePlan";
import type { WordStoryOp } from "./wordInPlaceStories";

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
 * paragraphs undoes all of it. `blocks`: indices into the expected slots of the blocks that differ. */
export type WordInPlaceVerification =
  | { ok: true }
  | { ok: false; locations: string[]; confined: boolean; blocks: number[] };

const MAX_LOCATIONS = 8;

export interface WordInPlaceVerifyInput {
  /** The expected block sequence over the live document the write started from. */
  slots: readonly WordInPlaceSlot[];
  /** Header and footer paragraphs the write rewrote; their parts are checked paragraph by paragraph. */
  stories?: readonly WordStoryOp[];
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
 * exactly the typed state the plan asked for, written table cells equal the compiled table, written
 * header and footer paragraphs read as planned, and nothing else outside the body changed beyond
 * list-definition identity.
 */
export function verifyWordInPlaceOutput({
  slots,
  stories = [],
  base,
  snapshot,
  compiled,
  compiledIndex,
  after,
}: WordInPlaceVerifyInput): WordInPlaceVerification {
  const locations: string[] = [];
  const blocks: number[] = [];
  const ops = slots.flatMap((slot) => (slot.kind === "op" ? [slot.op] : []));
  let confined = ops.every(
    (op) => op.kind === "cell" || (op.kind === "text" && !op.restyle),
  );
  const at = (index: number, field: string, written = false) => {
    locations.push(`/word/document.xml body block ${index + 1}: ${field}`);
    blocks.push(index);
    if (!written) confined = false;
  };
  if (after.issue)
    return {
      ok: false,
      locations: ["/word/document.xml: issue"],
      confined: false,
      blocks,
    };
  if (after.blocks.length !== slots.length)
    return {
      ok: false,
      locations: ["/word/document.xml body: count"],
      confined: false,
      blocks,
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
  const storyParts = new Set(stories.map((op) => op.story.part));
  if (
    counts[0].parts - counts[0].webextensionParts !==
      counts[1].parts - counts[1].webextensionParts ||
    counts[0].customXmlItems !== counts[1].customXmlItems
  ) {
    locations.push("/: package");
    confined = false;
  } else if (
    !sameWordPreservedParts(base.ooxml, after.ooxml, "content", storyParts)
  ) {
    locations.push("/: preserved parts");
    confined = false;
  }
  if (stories.length) {
    const story = verifyWordStoryOutput(
      base.ooxml,
      new DOMParser().parseFromString(after.ooxml, "application/xml"),
      after.ooxml,
      stories,
    );
    if (story.length) {
      locations.push(...story);
      confined = false;
    }
  }
  return locations.length
    ? {
        ok: false,
        locations: locations.slice(0, MAX_LOCATIONS),
        confined,
        blocks,
      }
    : { ok: true };
}

export interface WordTrackedVerifyInput
  extends Omit<WordInPlaceVerifyInput, "after"> {
  /** The package after the write, its revisions included. */
  afterOoxml: string;
  /** body.paragraphs IDs after the write, and those of the paragraphs inside written regions. */
  ids: readonly string[];
  touched: ReadonlySet<string>;
}

/**
 * Tracked tier: the write's revisions sit only in the written paragraphs; accepting them there gives
 * exactly what the block tier expects, and rejecting them there gives back the document the write
 * started from, block for block. Revisions elsewhere are someone else's and stay as they were.
 */
export function verifyWordTrackedRevisions(
  input: WordTrackedVerifyInput,
): WordInPlaceVerification {
  const { afterOoxml, ids, touched, base, snapshot } = input;
  const blocks: number[] = [];
  const fail = (locations: string[]): WordInPlaceVerification => ({
    ok: false,
    locations: locations.slice(0, MAX_LOCATIONS),
    confined: false,
    blocks,
  });
  const parse = (xml: string) =>
    new DOMParser().parseFromString(xml, "application/xml");
  const accepted = parse(afterOoxml);
  const rejected = parse(afterOoxml);
  const stories = input.stories ?? [];
  const scope = (doc: Document) => {
    const paragraphs = wordBodyParagraphElements(doc);
    if (paragraphs.length !== ids.length) return undefined;
    const elements = new Set(paragraphs.filter((_, i) => touched.has(ids[i])));
    for (const op of stories) {
      const root = wordStoryRoot(doc, op.story.part);
      const paragraph = root && wordStoryParagraphElements(root)[op.paragraph];
      if (!paragraph) return undefined;
      elements.add(paragraph);
    }
    return elements;
  };
  const acceptScope = scope(accepted);
  const rejectScope = scope(rejected);
  if (!acceptScope || !rejectScope)
    return fail(["/word/document.xml body: count"]);
  const locations: string[] = [];
  if (
    wordRevisionsOutside(accepted, acceptScope) !==
    wordRevisionsOutside(parse(base.ooxml), new Set())
  )
    locations.push("/word/document.xml: revisions");
  acceptWordRevisions(accepted, acceptScope);
  rejectWordRevisions(rejected, rejectScope);
  const serializer = new XMLSerializer();
  const view = (doc: Document) =>
    captureWordAuthoringSnapshot(
      serializer.serializeToString(doc),
      snapshot.identity,
      "Off",
      true,
      "verify",
    );
  const block = verifyWordInPlaceOutput({ ...input, after: view(accepted) });
  if (!block.ok) {
    locations.push(...block.locations);
    blocks.push(...block.blocks);
  }
  const original = view(rejected);
  const expected = createNativeContentSignature(base.ooxml);
  const actual = createNativeContentSignature(original.ooxml);
  if (original.issue || original.blocks.length !== base.blocks.length)
    locations.push("/word/document.xml body: rejected");
  else
    original.blocks.forEach((b, i) => {
      if (actual(b.xml) !== expected(base.blocks[i].xml))
        locations.push(`/word/document.xml body block ${i + 1}: rejected`);
    });
  const baseDoc = parse(base.ooxml);
  for (const part of new Set(stories.map((op) => op.story.part))) {
    const before = wordStoryRoot(baseDoc, part);
    const after = wordStoryRoot(rejected, part);
    if (
      !before ||
      !after ||
      expected(serializer.serializeToString(before), part) !==
        actual(serializer.serializeToString(after), part)
    )
      locations.push(`${part}: rejected`);
  }
  return locations.length ? fail(locations) : { ok: true };
}
