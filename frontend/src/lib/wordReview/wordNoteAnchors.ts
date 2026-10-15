import {
  effectiveWordMediaChildren,
  isWordMediaElementActive,
} from "./wordMediaComparison";
import { isWordTextHidden } from "./wordNativeContent";

/**
 * Where a note's reference goes, counted in the text view the plan validator checks offsets
 * against (F7, contract O-21/X-5): the whole block as nativeVisibleText reads it, its nodes joined
 * by a newline, paragraphs and table rows separated, cells by a tab, hidden and deleted text left
 * out. The writer used to count each paragraph's raw runs instead, so an offset in a table, after a
 * paragraph break or after hidden text landed somewhere else.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type ViewChar =
  | { char: string; kind: "text"; t: Element; index: number }
  | { char: string; kind: "atom"; node: Element }
  /** A paragraph, cell, row or node boundary: it stands where `paragraph` ends. */
  | { char: string; kind: "end"; paragraph: Element }
  /** A boundary after nodes without a paragraph: it stands where `paragraph` starts. */
  | { char: string; kind: "start"; paragraph: Element };

const isW = (e: Element, local: string) =>
  e.namespaceURI === W && e.localName === local;
const paragraphsOf = (node: Element) =>
  isW(node, "p")
    ? [node]
    : Array.from(node.getElementsByTagNameNS(W, "p")).filter(
        isWordMediaElementActive,
      );

/** Mirrors nativeVisibleText, keeping where each character comes from. */
function view(nodes: readonly Element[]): ViewChar[] {
  const out: ViewChar[] = [];
  const dropTrailing = (from: number, char: string) => {
    if (out.length > from && out[out.length - 1].char === char) out.pop();
  };
  const visit = (e: Element) => {
    if (e.namespaceURI === W) {
      if (isWordTextHidden(e)) return;
      if (e.localName === "t") {
        // UTF-16 units, as the validator counts offsets.
        const text = e.textContent ?? "";
        for (let index = 0; index < text.length; index++)
          out.push({ char: text[index], kind: "text", t: e, index });
        return;
      }
      if (e.localName === "tab") {
        out.push({ char: "\t", kind: "atom", node: e });
        return;
      }
      if (e.localName === "br" || e.localName === "cr") {
        out.push({ char: "\n", kind: "atom", node: e });
        return;
      }
    }
    const from = out.length;
    for (const child of effectiveWordMediaChildren(e)) visit(child);
    const cell = isW(e, "tc");
    if (cell || isW(e, "tr")) {
      dropTrailing(from, cell ? "\n" : "\t");
      out.push({
        char: cell ? "\t" : "\n",
        kind: "end",
        paragraph: paragraphsOf(e).at(-1) ?? e,
      });
    } else if (isW(e, "p")) out.push({ char: "\n", kind: "end", paragraph: e });
  };
  nodes.forEach((node, i) => {
    if (i) {
      const before = nodes.slice(0, i).flatMap(paragraphsOf).at(-1);
      const after = nodes.slice(i).flatMap(paragraphsOf)[0];
      if (before) out.push({ char: "\n", kind: "end", paragraph: before });
      else if (after) out.push({ char: "\n", kind: "start", paragraph: after });
    }
    const from = out.length;
    visit(node);
    dropTrailing(from, "\n");
  });
  return out;
}

/** The block text the validator counts a note offset in. */
export function wordNoteAnchorText(nodes: readonly Element[]): string {
  return view(nodes)
    .map((c) => c.char)
    .join("");
}

const startOf = (paragraph: Element, marker: Element) =>
  paragraph.insertBefore(
    marker,
    Array.from(paragraph.children).find((e) => !isW(e, "pPr")) ?? null,
  );

/** Puts `marker` beside `child` of its run: before it, or after `index` characters of a w:t. */
function placeInRun(child: Element, index: number, marker: Element): void {
  const run = child.parentElement;
  if (!run) throw new Error("An annotation anchor could not be located.");
  const props = Array.from(run.children).filter((e) => isW(e, "rPr"));
  const content = Array.from(run.children).filter((e) => !isW(e, "rPr"));
  const at = content.indexOf(child);
  const left = content.slice(0, at);
  const right = content.slice(at + 1);
  if (isW(child, "t")) {
    const text = child.textContent ?? "";
    const piece = (value: string) => {
      const copy = child.cloneNode(false) as Element;
      copy.textContent = value;
      copy.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace",
        "xml:space",
        "preserve",
      );
      return copy;
    };
    if (index > 0) left.push(piece(text.slice(0, index)));
    if (index < text.length) right.unshift(piece(text.slice(index)));
  } else if (index > 0) left.push(child);
  else right.unshift(child);
  if (!left.length) {
    run.before(marker);
    return;
  }
  if (!right.length) {
    run.after(marker);
    return;
  }
  const make = (parts: Element[]) => {
    const copy = run.cloneNode(false) as Element;
    copy.append(
      ...props.map((p) => p.cloneNode(true)),
      ...parts.map((p) => p.cloneNode(true)),
    );
    return copy;
  };
  run.replaceWith(make(left), marker, make(right));
}

/**
 * Inserts `marker` at `offset` in the view of `nodes`, or after its last character when there is no
 * offset. The marker stands before the character at `offset`; at a boundary it closes the paragraph
 * that boundary ends.
 */
export function placeWordNoteMarker(
  nodes: readonly Element[],
  offset: number | undefined,
  marker: Element,
): void {
  const paragraphs = nodes.flatMap(paragraphsOf);
  if (!paragraphs.length)
    throw new Error("An annotation anchor does not refer to a text block.");
  const chars = view(nodes);
  const at = offset ?? chars.length;
  if (!Number.isInteger(at) || at < 0 || at > chars.length)
    throw new Error("An annotation anchor is outside its block.");
  if (!chars.length) {
    startOf(paragraphs[0], marker);
    return;
  }
  const target = chars[Math.min(at, chars.length - 1)];
  const after = at === chars.length;
  if (target.kind === "text")
    placeInRun(target.t, target.index + (after ? 1 : 0), marker);
  else if (target.kind === "atom")
    placeInRun(target.node, after ? 1 : 0, marker);
  else if (target.kind === "start") startOf(target.paragraph, marker);
  else if (!after) target.paragraph.append(marker);
  else {
    const next = paragraphs[paragraphs.indexOf(target.paragraph) + 1];
    if (next) startOf(next, marker);
    else target.paragraph.append(marker);
  }
}
