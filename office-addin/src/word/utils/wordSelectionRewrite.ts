import {
  alignWordParagraph,
  wordKeptItemsShape,
  wordParagraphElement,
  wordPartBoundaries,
} from "./wordSelectionItems";

import type {
  WordAlignedParagraph,
  WordPartBoundary,
} from "./wordSelectionItems";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML = "http://www.w3.org/XML/1998/namespace";

/** A paragraph's package with part of its text rewritten and every kept item where it was. */
export interface WordParagraphRewrite {
  /** For paragraph.insertOoxml(…, "Replace"). */
  ooxml: string;
  /** The paragraph.text the rewritten paragraph must read back as. */
  rangeText: string;
}

const isW = (node: Node | null, name: string): node is Element =>
  node instanceof Element && node.namespaceURI === W && node.localName === name;

const TEXT_CHILDREN = new Set(["t", "tab", "lastRenderedPageBreak"]);

/**
 * Gives every item its own run, so new text can go right next to it: a w:br, note reference,
 * drawing or field character that shares a run with text is split off, each part keeping the
 * run's properties.
 */
function isolateItemRuns(paragraph: Element) {
  for (const run of Array.from(paragraph.getElementsByTagNameNS(W, "r"))) {
    const content = Array.from(run.children).filter(
      (c): boolean => !isW(c, "rPr"),
    );
    const groups: Element[][] = [];
    for (const child of content) {
      const text =
        child.namespaceURI === W && TEXT_CHILDREN.has(child.localName);
      const last = groups.at(-1);
      if (text && last && TEXT_CHILDREN.has(last[0].localName))
        last.push(child);
      else groups.push([child]);
    }
    if (groups.length < 2) continue;
    const props = Array.from(run.children).find((c) => isW(c, "rPr"));
    for (const group of groups) {
      const part = run.cloneNode(false) as Element;
      if (props) part.appendChild(props.cloneNode(true));
      for (const child of group) part.appendChild(child);
      run.parentNode!.insertBefore(part, run);
    }
    run.remove();
  }
}

function textElement(doc: Document, text: string): Element {
  const t = doc.createElementNS(W, "w:t");
  t.setAttributeNS(XML, "xml:space", "preserve");
  t.textContent = text;
  return t;
}

/** One w:t per character, so a part can start or end anywhere in a run. */
function splitTexts(paragraph: Element) {
  for (const t of Array.from(paragraph.getElementsByTagNameNS(W, "t"))) {
    const chars = Array.from(t.textContent ?? "");
    if (chars.length < 2) continue;
    for (const char of chars)
      t.parentNode!.insertBefore(textElement(t.ownerDocument, char), t);
    t.remove();
  }
}

const textOnly = (run: Element) =>
  Array.from(run.children).every(
    (c) => isW(c, "rPr") || isW(c, "t") || isW(c, "tab"),
  );

const serializedProps = (run: Element) => {
  const props = Array.from(run.children).find((c) => isW(c, "rPr"));
  return props ? new XMLSerializer().serializeToString(props) : "";
};

/** Joins neighbouring text runs with the same properties again, then each run's texts. */
function mergeTexts(paragraph: Element) {
  for (const run of Array.from(paragraph.getElementsByTagNameNS(W, "r"))) {
    const previous = run.previousElementSibling;
    if (
      isW(previous, "r") &&
      textOnly(previous) &&
      textOnly(run) &&
      serializedProps(previous) === serializedProps(run)
    ) {
      for (const child of Array.from(run.children))
        if (!isW(child, "rPr")) previous.appendChild(child);
      run.remove();
    }
  }
  for (const run of Array.from(paragraph.getElementsByTagNameNS(W, "r"))) {
    for (const t of Array.from(run.children)) {
      const previous = t.previousElementSibling;
      if (!isW(t, "t") || !isW(previous, "t")) continue;
      previous.textContent =
        (previous.textContent ?? "") + (t.textContent ?? "");
      previous.setAttributeNS(XML, "xml:space", "preserve");
      t.remove();
    }
    if (Array.from(run.children).every((c) => isW(c, "rPr"))) run.remove();
  }
}

function textNodes(doc: Document, text: string): Element[] {
  const nodes: Element[] = [];
  text.split("\t").forEach((part, index) => {
    if (index > 0) nodes.push(doc.createElementNS(W, "w:tab"));
    if (part) nodes.push(textElement(doc, part));
  });
  return nodes;
}

const holdsText = (node: Element) =>
  isW(node, "r") &&
  Array.from(node.children).some((c) => isW(c, "t") || isW(c, "tab"));

/**
 * A new run for text placed where there was none: it takes the properties of the nearest text run
 * beside it, never those of an item's own run (a note reference's superscript, say).
 */
function newRun(
  doc: Document,
  text: string,
  parent: Node,
  before: Node | null,
) {
  const siblings = Array.from(parent.childNodes).filter(
    (n): n is Element => n instanceof Element,
  );
  const at = before ? siblings.indexOf(before as Element) : siblings.length;
  const nearest =
    siblings.slice(0, at).reverse().find(holdsText) ??
    siblings.slice(at).find(holdsText);
  return runWith(doc, text, nearest ? propsOf(nearest) : undefined);
}

const propsOf = (run: Element) =>
  Array.from(run.children).find((c) => isW(c, "rPr"));

function runWith(doc: Document, text: string, props: Element | undefined) {
  const run = doc.createElementNS(W, "w:r");
  if (props?.children.length) run.appendChild(props.cloneNode(true));
  for (const node of textNodes(doc, text)) run.appendChild(node);
  return run;
}

/** Splits `node`'s run in two before it and returns the second, which starts with `node`. */
function splitRunBefore(node: Element): Element {
  const run = node.parentNode as Element;
  const kept = Array.from(run.children).filter((c): boolean => !isW(c, "rPr"));
  if (kept[0] === node) return run;
  const second = run.cloneNode(false) as Element;
  const props = propsOf(run);
  if (props) second.appendChild(props.cloneNode(true));
  for (const child of kept.slice(kept.indexOf(node))) second.appendChild(child);
  run.parentNode!.insertBefore(second, run.nextSibling);
  return second;
}

const propKey = (property: Element) =>
  `${property.localName}|${Array.from(property.attributes)
    .map((a) => `${a.name}=${a.value}`)
    .sort()
    .join(",")}|${new XMLSerializer().serializeToString(property)}`;

const propKeys = (runs: readonly Element[]) =>
  runs.map(
    (run) => new Set(Array.from(propsOf(run)?.children ?? []).map(propKey)),
  );

/**
 * Only the properties every one of a piece's old runs had: a rewrite whose first word was bold
 * would otherwise come out bold throughout. A property they did not share is left to the
 * paragraph's style, as for a selection without items.
 */
function sharedProps(runs: readonly Element[]): Element | undefined {
  const first = propsOf(runs[0]);
  if (!first || runs.length < 2) return first;
  const keys = propKeys(runs);
  const shared = first.cloneNode(false) as Element;
  for (const property of Array.from(first.children))
    if (keys.every((set) => set.has(propKey(property))))
      shared.appendChild(property.cloneNode(true));
  return shared;
}

/** The properties sharedProps leaves out: each one some of the runs have and others not. */
function droppedProps(runs: readonly Element[]): Element[] {
  if (runs.length < 2) return [];
  const keys = propKeys(runs);
  return runs.flatMap((run) =>
    Array.from(propsOf(run)?.children ?? []).filter(
      (property) => !keys.every((set) => set.has(propKey(property))),
    ),
  );
}

/** Where text goes that has no old text to take the place of: right before or after a boundary. */
function slot(
  aligned: WordAlignedParagraph,
  boundary: WordPartBoundary,
  side: "before" | "after",
): { parent: Node; before: Node | null } | null {
  const { item } = boundary;
  if (boundary.end === "point") {
    const nodes = aligned.points.get(item);
    if (!nodes) return null;
    return side === "before"
      ? { parent: nodes.first.parentNode!, before: nodes.first }
      : { parent: nodes.last.parentNode!, before: nodes.last.nextSibling };
  }
  const span = aligned.spans.get(item);
  if (!span) return null;
  const container = item.kind !== "comment";
  if (boundary.end === "open") {
    if (side === "before" && span.open)
      return { parent: span.open.parentNode!, before: span.open };
    if (container && span.inner)
      return { parent: span.inner, before: span.inner.firstChild };
    return span.open
      ? { parent: span.open.parentNode!, before: span.open.nextSibling }
      : null;
  }
  if (side === "before") {
    if (container && span.inner) return { parent: span.inner, before: null };
    return span.close
      ? { parent: span.close.parentNode!, before: span.close }
      : null;
  }
  if (!span.close) return null;
  const reference =
    item.kind === "comment"
      ? aligned.referenceRuns.get(boundary.at)
      : undefined;
  const after = reference ?? span.close;
  return { parent: after.parentNode!, before: after.nextSibling };
}

/**
 * The paragraph with its part [start, end) replaced by `pieces`, the text before, between and after
 * the part's markers. Only text is replaced; every item and everything outside the part stays as
 * it was. Null when the paragraph no longer matches the part, or when the result would not read
 * back as the expected text with the same items.
 */
export function rewriteWordParagraphPart(
  ooxml: string,
  rangeText: string,
  start: number,
  end: number,
  pieces: readonly string[],
): WordParagraphRewrite | null {
  const parsed = wordParagraphElement(ooxml);
  if (!parsed) return null;
  const { doc, paragraph } = parsed;
  isolateItemRuns(paragraph);
  splitTexts(paragraph);
  const aligned = alignWordParagraph(paragraph, rangeText);
  if ("refused" in aligned) return null;
  const part = wordPartBoundaries(rangeText, aligned, start, end);
  if (!part || pieces.length !== part.boundaries.length + 1) return null;
  const { boundaries, hidden } = part;
  const edges = [start, ...boundaries.map((b) => b.at), end];
  let expected = rangeText.slice(0, start);
  for (let k = 0; k < pieces.length; k += 1) {
    const old: Element[] = [];
    for (let at = edges[k]; at < edges[k + 1]; at += 1) {
      const char = aligned.chars[at];
      if (!hidden.has(at) && char) old.push(char.node);
    }
    const text = pieces[k];
    if (old.length) {
      const runs = [...new Set(old.map((node) => node.parentNode as Element))];
      const after = splitRunBefore(old[0]);
      after.parentNode!.insertBefore(
        runWith(doc, text, sharedProps(runs)),
        after,
      );
      for (const node of old) node.remove();
    } else if (text) {
      const place =
        k < boundaries.length
          ? slot(aligned, boundaries[k], "before")
          : k > 0
            ? slot(aligned, boundaries[k - 1], "after")
            : null;
      if (!place) return null;
      place.parent.insertBefore(
        newRun(doc, text, place.parent, place.before),
        place.before,
      );
    }
    expected += text;
    const boundary = boundaries[k];
    if (!boundary) continue;
    if (boundary.end === "point") expected += boundary.item.shows;
    else if (
      boundary.end === "close" &&
      boundary.item.kind === "comment" &&
      rangeText[boundary.at] === "\u0005"
    )
      expected += "\u0005";
  }
  expected += rangeText.slice(end);
  mergeTexts(paragraph);
  const serialized = new XMLSerializer().serializeToString(doc);
  const declaration = /^\s*<\?xml[^?]*\?>/.exec(ooxml)?.[0];
  const result =
    declaration && !serialized.startsWith("<?xml")
      ? declaration + serialized
      : serialized;
  const check = wordParagraphElement(result);
  const reread = check && alignWordParagraph(check.paragraph, expected);
  if (!reread || "refused" in reread) return null;
  if (wordKeptItemsShape(reread.items) !== wordKeptItemsShape(aligned.items))
    return null;
  return { ooxml: result, rangeText: expected };
}

/** What a rewrite of a part would not keep of its text's formatting, by what it changes. */
export interface WordPartFormatLoss {
  /** Bold, italic, underline or strikethrough on part of a piece's text. */
  emphasis: boolean;
  /** Superscript or subscript on part of a piece's text. */
  script: boolean;
  /** Any other property on part of a piece's text: a colour, highlight, font, size, character style. */
  other: boolean;
}

const EMPHASIS = new Set(["b", "bCs", "i", "iCs", "u", "strike"]);

/**
 * What a dropped property changes. Automatic colour, no highlight, baseline, a font hint alone and
 * the language marks are let through, as the plain path lets them through.
 */
function lossOf(property: Element): keyof WordPartFormatLoss | null {
  if (property.namespaceURI !== W) return "other";
  const name = property.localName;
  const val = property.getAttributeNS(W, "val");
  if (EMPHASIS.has(name)) return "emphasis";
  switch (name) {
    case "lang":
    case "noProof":
      return null;
    case "vertAlign":
      return val === "superscript" || val === "subscript" ? "script" : null;
    case "color":
      return val === "auto" ? null : "other";
    case "highlight":
      return val === "none" ? null : "other";
    case "rFonts":
      return Array.from(property.attributes).every(
        (a) => a.localName === "hint" || a.name.startsWith("xmlns"),
      )
        ? null
        : "other";
    default:
      return "other";
  }
}

/**
 * What rewriteWordParagraphPart would drop of the part [start, end)'s formatting. It writes each
 * piece between the part's markers with the properties all of that piece's old text runs share,
 * so a property on part of one piece is lost, while pieces formatted differently from each other
 * keep their own. An item's own runs (a field's result, a note reference) are kept as they are and
 * do not count; a link's text is a piece of its own, so its Hyperlink style is shared. Null when
 * the paragraph's items cannot be read or the part cuts through one.
 */
export function wordPartFormatLoss(
  ooxml: string,
  rangeText: string,
  start: number,
  end: number,
): WordPartFormatLoss | null {
  const parsed = wordParagraphElement(ooxml);
  if (!parsed) return null;
  const aligned = alignWordParagraph(parsed.paragraph, rangeText);
  if ("refused" in aligned) return null;
  const part = wordPartBoundaries(rangeText, aligned, start, end);
  if (!part) return null;
  const edges = [start, ...part.boundaries.map((b) => b.at), end];
  const loss: WordPartFormatLoss = {
    emphasis: false,
    script: false,
    other: false,
  };
  for (let k = 0; k + 1 < edges.length; k += 1) {
    const runs = new Set<Element>();
    for (let at = edges[k]; at < edges[k + 1]; at += 1) {
      const char = aligned.chars[at];
      if (!part.hidden.has(at) && char)
        runs.add(char.node.parentNode as Element);
    }
    for (const property of droppedProps([...runs])) {
      const kind = lossOf(property);
      if (kind) loss[kind] = true;
    }
  }
  return loss;
}
