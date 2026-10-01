import {
  WORDPROCESSING_NS as W,
  readWordRunFormatting,
} from "./wordBlockFormatting";
import {
  sameWordInPlaceRuns,
  wordInPlaceSourceRuns,
  wordNonMarkRunProperties,
  wordStoryReference,
} from "./wordInPlacePlan";
import { plainText, wordBlockParagraphs } from "./wordLiveParagraphs";
import { createNativeContentSignature } from "./wordNativeContent";
import { extractWordSections } from "./wordStories";

import type { WordInPlaceOp, WordInPlaceStoryTarget } from "./wordInPlacePlan";
import type { WordPredictedParagraph } from "./wordLiveParagraphs";

const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";

export type WordStoryOp = Extract<WordInPlaceOp, { kind: "text" }> & {
  story: WordInPlaceStoryTarget;
};

export const isWordStoryOp = (op: WordInPlaceOp): op is WordStoryOp =>
  op.kind === "text" && !!op.story;

/** One object-model container per story the write touches. */
export const wordStoryKey = (target: WordInPlaceStoryTarget) =>
  `${target.kind}:${target.section}:${target.type}`;

/** Body.paragraphs of the header or footer that section `target.section` itself references. */
export function wordStoryParagraphs(
  sections: Word.SectionCollection,
  target: WordInPlaceStoryTarget,
): Word.ParagraphCollection {
  const section = sections.items[target.section];
  if (!section) throw new Error("A written story's section is missing.");
  return (
    target.kind === "header"
      ? section.getHeader(target.type)
      : section.getFooter(target.type)
  ).paragraphs;
}

export function wordStoryRoot(
  doc: Document,
  part: string,
): Element | undefined {
  const found = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (e) => e.getAttributeNS(PKG, "name") === part,
  );
  return (
    Array.from(found?.children ?? []).find(
      (e) => e.namespaceURI === PKG && e.localName === "xmlData",
    )?.firstElementChild ?? undefined
  );
}

/** The story's paragraphs in Body.paragraphs order. */
export function wordStoryParagraphElements(root: Element): Element[] {
  return wordBlockParagraphs(Array.from(root.children), root);
}

const parse = (ooxml: string) =>
  new DOMParser().parseFromString(ooxml, "application/xml");

export function predictWordStoryParagraphs(
  ooxml: string,
  part: string,
): WordPredictedParagraph[] {
  const root = wordStoryRoot(parse(ooxml), part);
  if (!root) throw new Error("A written story is missing from the package.");
  return wordStoryParagraphElements(root).map((paragraph, index) => {
    let nesting = 0;
    for (let a = paragraph.parentElement; a && a !== root; a = a.parentElement)
      if (a.namespaceURI === W && a.localName === "tbl") nesting++;
    const text = plainText(paragraph);
    return {
      ref: part,
      index,
      nesting,
      ...(text === undefined ? {} : { text }),
    };
  });
}

const serialize = (e: Element) => new XMLSerializer().serializeToString(e);

/** Stale check for a story the write targets: its part is unchanged and the same single section
 * reference still leads to it. */
export function wordStoryUnchanged(
  captured: string,
  live: string,
  target: WordInPlaceStoryTarget,
  id: string,
): boolean {
  const before = wordStoryRoot(parse(captured), target.part);
  const liveDoc = parse(live);
  const after = wordStoryRoot(liveDoc, target.part);
  if (!before || !after) return false;
  const reference = wordStoryReference(
    { sections: extractWordSections(liveDoc) },
    id,
    target.kind,
  );
  return (
    reference?.section === target.section &&
    reference.type === target.type &&
    createNativeContentSignature(captured)(serialize(before), target.part) ===
      createNativeContentSignature(live)(serialize(after), target.part)
  );
}

function typedRuns(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagNameNS(W, "r")).map((run) => {
    const props = Array.from(run.children).find(
      (e) => e.namespaceURI === W && e.localName === "rPr",
    );
    const on = (name: string) =>
      Array.from(props?.children ?? []).some(
        (e) =>
          e.namespaceURI === W &&
          e.localName === name &&
          (name === "u"
            ? e.getAttributeNS(W, "val") !== "none"
            : !["0", "false", "off"].includes(
                e.getAttributeNS(W, "val") ?? "",
              )),
      );
    return {
      text: Array.from(run.children)
        .map((e) =>
          e.namespaceURI !== W
            ? ""
            : e.localName === "t"
              ? (e.textContent ?? "")
              : e.localName === "tab"
                ? "\t"
                : "",
        )
        .join(""),
      bold: on("b"),
      italic: on("i"),
      underline: on("u"),
      nonMark: wordNonMarkRunProperties(
        props ? readWordRunFormatting(props) : {},
      ),
    };
  });
}

/**
 * Written story paragraphs read exactly as planned (text, marks, the source's other run properties
 * and paragraph properties); every other paragraph of the story is unchanged.
 */
export function verifyWordStoryOutput(
  before: string,
  after: Document,
  afterOoxml: string,
  ops: readonly WordStoryOp[],
): string[] {
  const locations: string[] = [];
  const beforeDoc = parse(before);
  const beforeSignature = createNativeContentSignature(before);
  const afterSignature = createNativeContentSignature(afterOoxml);
  const parts = [...new Set(ops.map((op) => op.story.part))];
  for (const part of parts) {
    const at = (field: string) =>
      /^\/word\/[A-Za-z0-9_.-]{1,80}\.xml$/.test(part)
        ? `${part}: ${field}`
        : `/word: ${field}`;
    const sourceRoot = wordStoryRoot(beforeDoc, part);
    const writtenRoot = wordStoryRoot(after, part);
    if (!sourceRoot || !writtenRoot) {
      locations.push(at("missing"));
      continue;
    }
    const source = wordStoryParagraphElements(sourceRoot);
    const written = wordStoryParagraphElements(writtenRoot);
    if (source.length !== written.length) {
      locations.push(at("count"));
      continue;
    }
    const touched = new Map(
      ops
        .filter((op) => op.story.part === part)
        .map((op) => [op.paragraph, op]),
    );
    const pPr = (p: Element, signature: typeof beforeSignature) => {
      const props = Array.from(p.children).find(
        (e) => e.namespaceURI === W && e.localName === "pPr",
      );
      return props ? signature(serialize(props), part) : "";
    };
    written.forEach((paragraph, i) => {
      const op = touched.get(i);
      if (!op) {
        if (
          beforeSignature(serialize(source[i]), part) !==
          afterSignature(serialize(paragraph), part)
        )
          locations.push(at(`paragraph ${i + 1} signature`));
        return;
      }
      const shape = wordInPlaceSourceRuns(source[i]);
      const runs = typedRuns(paragraph);
      if (
        "fallback" in shape ||
        runs.map((r) => r.text).join("") !==
          op.runs.map((r) => r.text).join("") ||
        !sameWordInPlaceRuns(
          runs.map(({ text, bold, italic, underline }) => ({
            text,
            bold,
            italic,
            underline,
          })),
          op.runs,
        ) ||
        runs.some((r) => r.text && r.nonMark !== shape.nonMark) ||
        pPr(source[i], beforeSignature) !== pPr(paragraph, afterSignature)
      )
        locations.push(at(`paragraph ${i + 1} runs`));
    });
  }
  return locations;
}
