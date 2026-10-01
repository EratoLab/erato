import { isWordMediaElementActive } from "./wordMediaComparison";
import { nativeBodyGroups, wordMainBody } from "./wordNativeContent";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** One entry of Word's body.paragraphs as predicted from the captured package. */
export interface WordPredictedParagraph {
  /** Snapshot block that owns the paragraph. */
  ref: string;
  /** Position among the paragraphs of that block. */
  index: number;
  /** Number of enclosing tables, as Paragraph.tableNestingLevel reports it. */
  nesting: number;
  /** Only for paragraphs whose visible text has no fields, revisions, hidden runs or objects. */
  text?: string;
}

export interface WordLiveParagraph {
  id: string;
  nesting: number;
  text?: string;
}

const isW = (e: Element, name: string) =>
  e.namespaceURI === W && e.localName === name;
const PLAIN_PARAGRAPH = new Set([
  "pPr",
  "r",
  "proofErr",
  "bookmarkStart",
  "bookmarkEnd",
  "hyperlink",
]);
const PLAIN_RUN = new Set([
  "rPr",
  "t",
  "tab",
  "br",
  "cr",
  "lastRenderedPageBreak",
]);
const on = (e: Element) =>
  !["0", "false", "off"].includes(e.getAttributeNS(W, "val") ?? "");

/** Word reports soft line breaks as \v and carriage returns as \r; captured text uses \n. */
export function normalizeWordParagraphText(text: string): string {
  return text.replace(/\r\n|\r|\v/g, "\n");
}

/** Visible text of a paragraph without fields, revisions, hidden runs or objects; else undefined. */
export function plainText(paragraph: Element): string | undefined {
  let text = "";
  const runs = (parent: Element): boolean =>
    Array.from(parent.children).every((child) => {
      if (child.namespaceURI !== W || !PLAIN_PARAGRAPH.has(child.localName))
        return false;
      if (child.localName === "hyperlink") return runs(child);
      if (child.localName !== "r") return true;
      return Array.from(child.children).every((part) => {
        if (part.namespaceURI !== W || !PLAIN_RUN.has(part.localName))
          return false;
        if (part.localName === "rPr")
          return !Array.from(part.children).some(
            (p) =>
              (isW(p, "vanish") ||
                isW(p, "webHidden") ||
                isW(p, "specVanish")) &&
              on(p),
          );
        if (part.localName === "t") text += part.textContent ?? "";
        else if (part.localName === "tab") text += "\t";
        else if (part.localName === "cr") text += "\n";
        else if (part.localName === "br") {
          const type = part.getAttributeNS(W, "type");
          if (type && type !== "textWrapping") return false;
          text += "\n";
        }
        return true;
      });
    });
  return runs(paragraph) ? text : undefined;
}

/** The paragraphs body.paragraphs lists for these top-level nodes, in document order: table cells and
 * block content controls included, text-box content and inactive alternate content left out. */
export function wordBlockParagraphs(
  nodes: readonly Element[],
  root: Element,
): Element[] {
  return nodes.flatMap((node) =>
    [
      ...(isW(node, "p") ? [node] : []),
      ...Array.from(node.getElementsByTagNameNS(W, "p")),
    ].filter((paragraph) => {
      if (!isWordMediaElementActive(paragraph)) return false;
      for (
        let ancestor = paragraph.parentElement;
        ancestor && ancestor !== root;
        ancestor = ancestor.parentElement
      )
        if (isW(ancestor, "txbxContent")) return false;
      return true;
    }),
  );
}

/** The body paragraph elements of a parsed package, in body.paragraphs order. */
export function wordBodyParagraphElements(doc: Document): Element[] {
  const body = wordMainBody(doc);
  if (!body) throw new Error("The document has no readable body.");
  return nativeBodyGroups(body).groups.flatMap((nodes) =>
    wordBlockParagraphs(nodes, body),
  );
}

/** Every body paragraph as Word lists it in body.paragraphs, with the snapshot block that owns it. */
export function predictWordBodyParagraphs(
  packageXml: string,
): WordPredictedParagraph[] {
  const doc = new DOMParser().parseFromString(packageXml, "application/xml");
  const body = wordMainBody(doc);
  if (!body || doc.getElementsByTagName("parsererror").length)
    throw new Error("The captured document has no readable body.");
  const result: WordPredictedParagraph[] = [];
  nativeBodyGroups(body).groups.forEach((nodes, group) =>
    wordBlockParagraphs(nodes, body).forEach((paragraph, index) => {
      let nesting = 0;
      for (
        let ancestor = paragraph.parentElement;
        ancestor && ancestor !== body;
        ancestor = ancestor.parentElement
      )
        if (isW(ancestor, "tbl")) nesting++;
      const text = plainText(paragraph);
      result.push({
        ref: `b${group + 1}`,
        index,
        nesting,
        ...(text === undefined ? {} : { text }),
      });
    }),
  );
  return result;
}

export type WordParagraphAlignmentIssue = "count" | "nesting" | "text" | "id";

/** The first mismatch between the predicted and the live paragraph list, if any.
 * Text is compared only at `positions` and only where the prediction has plain text. */
export function wordParagraphAlignmentIssue(
  predicted: readonly WordPredictedParagraph[],
  live: readonly WordLiveParagraph[],
  positions?: Iterable<number>,
): { issue: WordParagraphAlignmentIssue; index?: number } | undefined {
  if (predicted.length !== live.length) return { issue: "count" };
  if (new Set(live.map((p) => p.id)).size !== live.length)
    return { issue: "id" };
  const nesting = predicted.findIndex((p, i) => p.nesting !== live[i].nesting);
  if (nesting >= 0) return { issue: "nesting", index: nesting };
  for (const i of positions ?? predicted.keys()) {
    const expected = predicted[i]?.text;
    if (expected === undefined) continue;
    const actual = live[i]?.text;
    if (actual === undefined || normalizeWordParagraphText(actual) !== expected)
      return { issue: "text", index: i };
  }
  return undefined;
}

/** Live paragraph IDs per snapshot block, or null when the prediction does not hold exactly. */
export function alignWordLiveParagraphs(
  predicted: readonly WordPredictedParagraph[],
  live: readonly WordLiveParagraph[],
  positions?: Iterable<number>,
): Map<string, string[]> | null {
  if (wordParagraphAlignmentIssue(predicted, live, positions)) return null;
  const result = new Map<string, string[]>();
  predicted.forEach((p, i) =>
    result.set(p.ref, [...(result.get(p.ref) ?? []), live[i].id]),
  );
  return result;
}
