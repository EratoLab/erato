const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Run-level containers of tracked insertions and deletions. Inside w:rPr they mark a paragraph mark
 * instead, inside w:trPr a table row. */
const INSERTED = new Set(["ins", "moveTo"]);
const DELETED = new Set(["del", "moveFrom"]);
const RANGE_MARKERS = new Set([
  "moveFromRangeStart",
  "moveFromRangeEnd",
  "moveToRangeStart",
  "moveToRangeEnd",
]);
const PROPERTY_CHANGES = new Set([
  "rPrChange",
  "pPrChange",
  "sectPrChange",
  "tblPrChange",
  "tblPrExChange",
  "trPrChange",
  "tcPrChange",
  "tblGridChange",
  "numberingChange",
]);
/** Every element that records a pending revision. Rewriting content that holds one would accept or
 * reject someone else's change, and a tracked write could not be rejected apart from it. */
export const WORD_REVISION_ELEMENTS = [
  "ins",
  "del",
  "moveFrom",
  "moveTo",
  "pPrChange",
  "rPrChange",
  "numberingChange",
  "tblPrChange",
  "tblPrExChange",
  "tblGridChange",
  "trPrChange",
  "tcPrChange",
  "cellIns",
  "cellDel",
  "cellMerge",
] as const;
/** CT_ParaRPr and CT_RPr keep revision markers ahead of the properties. */
const MARKERS = new Set([...INSERTED, ...DELETED]);

const isW = (e: Element | null | undefined, name?: string): boolean =>
  !!e && e.namespaceURI === W && (!name || e.localName === name);
const all = (root: Document | Element, names: ReadonlySet<string>) =>
  Array.from(root.getElementsByTagNameNS(W, "*")).filter((e) =>
    names.has(e.localName),
  );

/** Where a revision element applies: a paragraph mark, a table row, or content inside a run. */
function placement(e: Element): "mark" | "row" | "content" {
  const parent = e.parentElement;
  if (isW(parent, "rPr") && isW(parent?.parentElement, "pPr")) return "mark";
  if (isW(parent, "trPr")) return "row";
  return "content";
}

function owningParagraph(e: Element): Element | undefined {
  for (let a: Element | null = e; a; a = a.parentElement)
    if (isW(a, "p")) return a;
  return undefined;
}

/** Without a scope every revision applies; with one, only those inside the listed paragraphs
 * (their content, properties and paragraph marks). Table rows and sections need no scope. */
function inScope(e: Element, scope: ReadonlySet<Element> | undefined): boolean {
  if (!scope) return true;
  const paragraph = owningParagraph(e);
  return !!paragraph && scope.has(paragraph);
}

function unwrap(e: Element): void {
  e.replaceWith(...Array.from(e.childNodes));
}

function rename(e: Element, local: string): void {
  const made = e.ownerDocument.createElementNS(W, `w:${local}`);
  for (const attribute of Array.from(e.attributes))
    made.setAttributeNS(
      attribute.namespaceURI,
      attribute.name,
      attribute.value,
    );
  made.append(...Array.from(e.childNodes));
  e.replaceWith(made);
}

/** Drops a paragraph-mark marker and the paragraph-mark properties it leaves empty. */
function dropMarker(marker: Element): void {
  const props = marker.parentElement;
  marker.remove();
  if (props && !props.children.length && !props.attributes.length) {
    const pPr = props.parentElement;
    props.remove();
    if (pPr && !pPr.children.length && !pPr.attributes.length) pPr.remove();
  }
}

/** Body-level range markers that may sit between two paragraphs. */
const BETWEEN = new Set([
  "bookmarkStart",
  "bookmarkEnd",
  "commentRangeStart",
  "commentRangeEnd",
  "permStart",
  "permEnd",
  "proofErr",
  ...RANGE_MARKERS,
]);

/** A paragraph whose mark goes away joins the paragraph after it, which keeps its own properties. */
function mergeIntoNext(paragraph: Element): void {
  let next = paragraph.nextElementSibling;
  while (next && (!isW(next) || BETWEEN.has(next.localName)))
    next = next.nextElementSibling;
  if (!next || !isW(next, "p")) {
    // Word keeps a mark that ends a table cell, a story or the body.
    for (const e of Array.from(paragraph.getElementsByTagNameNS(W, "*")))
      if (MARKERS.has(e.localName) && placement(e) === "mark") dropMarker(e);
    return;
  }
  const content = Array.from(paragraph.childNodes).filter(
    (node) => !(node.nodeType === 1 && isW(node as Element, "pPr")),
  );
  const nextProps = Array.from(next.children).find((e) => isW(e, "pPr"));
  const anchor = nextProps ? nextProps.nextSibling : next.firstChild;
  for (const node of content) next.insertBefore(node, anchor);
  paragraph.remove();
}

/** Old properties held by a property change replace the current ones; revision markers stay. */
function restoreProperties(change: Element): void {
  const parent = change.parentElement;
  const old = Array.from(change.children).find((e) => isW(e));
  if (!parent) return;
  const kept = Array.from(parent.children).filter((e) => {
    if (e === change) return false;
    if (isW(parent, "rPr")) return isW(e) && MARKERS.has(e.localName);
    if (isW(parent, "pPr"))
      return isW(e, "rPr") || isW(e, "sectPr") || isW(e, "pPrChange");
    return false;
  });
  const restored = old ? Array.from(old.children) : [];
  change.remove();
  if (isW(parent, "rPr")) {
    parent.replaceChildren(...kept, ...restored);
  } else if (isW(parent, "pPr")) {
    parent.replaceChildren(...restored, ...kept);
  } else {
    parent.replaceChildren(...restored);
  }
}

function transform(
  root: Document | Element,
  accept: boolean,
  scope: ReadonlySet<Element> | undefined,
): void {
  for (const change of all(root, PROPERTY_CHANGES)) {
    if (!inScope(change, scope)) continue;
    if (accept) change.remove();
    else restoreProperties(change);
  }
  for (const marker of all(root, RANGE_MARKERS))
    if (inScope(marker, scope)) marker.remove();
  const kept = accept ? INSERTED : DELETED;
  const dropped = accept ? DELETED : INSERTED;
  const mergers: Element[] = [];
  for (const e of all(root, new Set([...kept, ...dropped]))) {
    if (!inScope(e, scope)) continue;
    const where = placement(e);
    if (where === "row") {
      if (scope) continue;
      if (dropped.has(e.localName)) {
        let row: Element | null = e;
        while (row && !isW(row, "tr")) row = row.parentElement;
        row?.remove();
      } else e.remove();
      continue;
    }
    if (where === "mark") {
      if (dropped.has(e.localName)) {
        const paragraph = owningParagraph(e);
        if (paragraph) mergers.push(paragraph);
        dropMarker(e);
      } else dropMarker(e);
      continue;
    }
    if (dropped.has(e.localName)) e.remove();
    else {
      if (!accept)
        for (const text of Array.from(e.getElementsByTagNameNS(W, "*")))
          if (text.localName === "delText") rename(text, "t");
          else if (text.localName === "delInstrText") rename(text, "instrText");
      unwrap(e);
    }
  }
  for (const paragraph of mergers.reverse())
    if (paragraph.parentNode) mergeIntoNext(paragraph);
}

/** Accept tracked revisions: insertions stay, deletions go, property changes keep the new values and
 * a deleted paragraph mark joins its paragraph to the next one. In place. */
export function acceptWordRevisions(
  root: Document | Element,
  scope?: ReadonlySet<Element>,
): void {
  transform(root, true, scope);
}

/** Reject tracked revisions: insertions go, deleted text returns, property changes restore the old
 * values and an inserted paragraph mark joins its paragraph to the next one. In place. */
export function rejectWordRevisions(
  root: Document | Element,
  scope?: ReadonlySet<Element>,
): void {
  transform(root, false, scope);
}

function view(ooxml: string, apply: (doc: Document) => void): string {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("Unreadable Word package.");
  apply(doc);
  return new XMLSerializer().serializeToString(doc);
}

/** The document as it reads once every tracked revision is accepted. */
export function acceptedWordView(ooxml: string): string {
  return view(ooxml, (doc) => acceptWordRevisions(doc));
}

/** The document as it read before any tracked revision. */
export function rejectedWordView(ooxml: string): string {
  return view(ooxml, (doc) => rejectWordRevisions(doc));
}

const REVISIONS = new Set([
  ...INSERTED,
  ...DELETED,
  ...PROPERTY_CHANGES,
  ...RANGE_MARKERS,
]);

/** Tracked revisions outside the given paragraphs. */
export function wordRevisionsOutside(
  root: Document | Element,
  scope: ReadonlySet<Element>,
): number {
  return all(root, REVISIONS).filter((e) => {
    const paragraph = owningParagraph(e);
    return !paragraph || !scope.has(paragraph);
  }).length;
}
