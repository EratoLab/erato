import { normalizeParagraphText } from "./buildWordDocumentArgs";
import { wordIdentityShows } from "./wordSelectionAnchor";
import { wordCellParagraphOoxml } from "./wordSelectionSpan";

import type { WordCommentWhere } from "@erato/frontend/word-review";

/**
 * Where comments sit in the text, read from getOoxml() packages with no Office.js call (ERMAIN-948).
 * Every host's paragraph package carries the comments parts, so a mark's package-local w:id leads
 * to Comment.id: w:id → the comment's last paragraph's w14:paraId → commentsIds durableId (hex),
 * whose decimal String() is Comment.id (probe ERMAIN-947, G1 and P-JOIN). A comment that spans
 * paragraphs has no marks in either end paragraph's own package; the package of the range from
 * the first to the last paragraph has them, and so does the comment's getRange().text by text
 * arithmetic, which is the only route on the web.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const W16CEX = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";

/** What Word for the web shows in paragraph.text at a comment's balloon anchor. */
const COMMENT_ANCHOR = "\u0005";
const NOTE_ANCHOR = "\u0002";
const ANCHOR_MARKS = /[\u0002\u0005]/g;
/** What joins the paragraphs of a range's text: "\r", or "\t" (desktop) and "\r\u0007" across cells. */
const SEPARATORS = new Set(["\r", "\n", "\t", "\u0007"]);
const PARAGRAPH_MARKS = /[\r\n\u0007]+$/;
const LINES = /[\r\n\u0007]+/;
const ELLIPSIS = "…";
const AFTER_CHARS = 20;

export type WordCommentJoin = "durableId" | "content";

/** One w:comment of a package, with what the package's other comment parts say about it. */
export interface WordPackageComment {
  /** Package-local: Word numbers a package's comments afresh. */
  wId: string;
  /** String(Comment.id); null without a commentsIds entry, as in every legacy file. */
  commentId: string | null;
  /** The w:id of the comment this one replies to (commentsExtended). */
  parentWId: string | null;
  /** commentsExtended's done; null when the package has no entry. */
  done: boolean | null;
  author: string;
  initials: string;
  /** w:date: the author's local time with a fake Z. */
  date: string | null;
  /** commentsExtensible's dateUtc; null when the file has none for this comment. */
  dateUtc: string | null;
  /** Plain text, paragraphs joined by "\n". */
  content: string;
}

export interface WordCommentEdge {
  /** Index into the paragraphs given, and into the read's views. */
  paragraph: number;
  /** In paragraph.text; null when that paragraph's views could not be mapped. */
  range: number | null;
  /** In the paragraph's visible text; null when its views could not be mapped. */
  visible: number | null;
}

/** One comment's marks in a package. */
export interface WordCommentSpan {
  wId: string;
  commentId: string | null;
  joinedBy: WordCommentJoin | null;
  /** Null when the comment starts before the package's first paragraph. */
  start: WordCommentEdge | null;
  /** Null when it ends after the package's last paragraph. */
  end: WordCommentEdge | null;
  /** The balloon anchor, where the web shows U+0005. */
  reference: WordCommentEdge | null;
  /** No visible text of its own: a collapsed range, or a reference alone. */
  point: boolean;
  /** Starts and ends in different table cells. */
  multiCell: boolean;
}

export interface WordParagraphTexts {
  /** paragraph.text, which holds U+0005 on the web, tracked deletions, and hidden text on the web. */
  rangeText: string;
  /**
   * getText(WORD_SELECTION_TEXT_OPTIONS). When given, the visible view must spell it, so the offsets
   * count in the text the model saw.
   */
  identityText?: string;
  inCell?: boolean;
}

/** A paragraph's two text views and the map between them. */
export interface WordParagraphView {
  rangeText: string;
  /** No hidden text, no tracked deletions, no U+0005 or U+0002. */
  visibleText: string;
  /** visibleAt[i] is the visible offset of paragraph.text offset i, for i in 0..rangeText.length. */
  visibleAt: readonly number[];
}

export interface WordCommentPackageRead {
  /** No commentsIds part: ids are not stable, and marks join by content only (contract §4.5). */
  legacy: boolean;
  comments: WordPackageComment[];
  /** One per paragraph given; null where the package and paragraph.text disagree. */
  views: (WordParagraphView | null)[];
  /** In document order of each comment's first mark. */
  spans: WordCommentSpan[];
}

type CharKind = "text" | "break" | "opaque" | "hidden" | "deleted" | "mark";

type Atom =
  | {
      type: "text";
      text: string;
      kind: "text" | "break";
      hidden: boolean;
      deleted: boolean;
    }
  /** A picture, symbol, page break or anything else paragraph.text may show as one character or none. */
  | { type: "opaque"; hidden: boolean; deleted: boolean }
  | { type: "note" }
  | { type: "mark"; mark: "start" | "end" | "reference"; wId: string };

interface PackageParagraph {
  atoms: Atom[];
  /** Tells table cells apart within one package; null outside tables. */
  cell: number | null;
}

const isW = (element: Element, name?: string) =>
  element.namespaceURI === W && (!name || element.localName === name);

const childrenOf = (element: Element, name?: string) =>
  Array.from(element.children).filter((child) => isW(child, name));

const attr = (element: Element, name: string) =>
  element.getAttributeNS(W, name) ?? element.getAttribute(`w:${name}`);

const onOff = (element: Element) => {
  const value = attr(element, "val");
  return value === null || !["0", "false", "off"].includes(value);
};

function parse(ooxml: string): Document | null {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

function mainBody(doc: Document): Element | null {
  const main =
    Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
      (part) =>
        (part.getAttributeNS(PKG, "name") ?? part.getAttribute("pkg:name")) ===
        "/word/document.xml",
    ) ?? doc.documentElement;
  return main.getElementsByTagNameNS(W, "body")[0] ?? null;
}

/** Rows of a table, or cells of a row, through the content controls and custom XML around them. */
function flattened(element: Element, name: string): Element[] {
  return childrenOf(element).flatMap((child) => {
    if (child.localName === name) return [child];
    if (child.localName === "customXml") return flattened(child, name);
    if (child.localName !== "sdt") return [];
    const content = childrenOf(child, "sdtContent")[0];
    return content ? flattened(content, name) : [];
  });
}

const markAtom = (element: Element, mark: "start" | "end" | "reference") =>
  ({ type: "mark", mark, wId: attr(element, "id") ?? "" }) as const;

/** The paragraph's content in document order, as paragraph.text and the visible text spell it. */
function inlineAtoms(paragraph: Element, out: Atom[]) {
  // Per open complex field: whether its code, which no text view shows, is still running.
  const fields: boolean[] = [];
  const inCode = () => fields.some(Boolean);
  const run = (element: Element, deleted: boolean) => {
    const rPr = childrenOf(element, "rPr")[0];
    const hidden =
      !!rPr && childrenOf(rPr, "vanish").some((vanish) => onOff(vanish));
    const text = (value: string, kind: "text" | "break" = "text") => {
      if (value && !inCode())
        out.push({ type: "text", text: value, kind, hidden, deleted });
    };
    const opaque = () => {
      if (!inCode()) out.push({ type: "opaque", hidden, deleted });
    };
    for (const child of Array.from(element.children)) {
      if (!isW(child)) {
        opaque();
        continue;
      }
      switch (child.localName) {
        case "rPr":
        case "lastRenderedPageBreak":
        case "annotationRef":
        case "instrText":
        case "delInstrText":
          break;
        case "t":
          text(child.textContent ?? "");
          break;
        case "delText":
          if (!inCode())
            out.push({
              type: "text",
              text: child.textContent ?? "",
              kind: "text",
              hidden,
              deleted: true,
            });
          break;
        case "tab":
          text("\t");
          break;
        case "br": {
          const type = attr(child, "type");
          if (!type || type === "textWrapping") text("\u000B", "break");
          else opaque();
          break;
        }
        case "fldChar": {
          const type = attr(child, "fldCharType");
          if (type === "begin") fields.push(true);
          else if (type === "separate" && fields.length)
            fields[fields.length - 1] = false;
          else if (type === "end") fields.pop();
          break;
        }
        case "commentReference":
          out.push(markAtom(child, "reference"));
          break;
        case "footnoteReference":
        case "endnoteReference":
          if (!inCode()) out.push({ type: "note" });
          break;
        default:
          opaque();
      }
    }
  };
  const visit = (element: Element, deleted: boolean) => {
    for (const child of Array.from(element.children)) {
      if (!isW(child)) {
        out.push({ type: "opaque", hidden: false, deleted });
        continue;
      }
      switch (child.localName) {
        case "pPr":
        case "proofErr":
        case "bookmarkStart":
        case "bookmarkEnd":
        case "sdtPr":
        case "sdtEndPr":
          break;
        case "r":
          run(child, deleted);
          break;
        case "commentRangeStart":
          out.push(markAtom(child, "start"));
          break;
        case "commentRangeEnd":
          out.push(markAtom(child, "end"));
          break;
        case "del":
        case "moveFrom":
          visit(child, true);
          break;
        default:
          // ins, moveTo, hyperlink, fldSimple (its runs are the result), sdt, smartTag, customXml,
          // and range marks without text.
          visit(child, deleted);
      }
    }
  };
  visit(paragraph, false);
}

/**
 * Every paragraph of a package in document order, cell paragraphs included. Comment marks between
 * paragraphs belong to the next paragraph's start (a start) or the last paragraph's end.
 */
function packageParagraphs(body: Element): PackageParagraph[] {
  const out: PackageParagraph[] = [];
  let pending: Atom[] = [];
  let cells = 0;
  const visit = (container: Element, cell: number | null) => {
    for (const child of childrenOf(container)) {
      switch (child.localName) {
        case "p": {
          const atoms = pending;
          pending = [];
          inlineAtoms(child, atoms);
          out.push({ atoms, cell });
          break;
        }
        case "tbl":
          for (const row of flattened(child, "tr"))
            for (const tc of flattened(row, "tc")) visit(tc, cells++);
          break;
        case "sdt": {
          const content = childrenOf(child, "sdtContent")[0];
          if (content) visit(content, cell);
          break;
        }
        case "customXml":
          visit(child, cell);
          break;
        case "commentRangeStart":
          pending.push(markAtom(child, "start"));
          break;
        case "commentRangeEnd":
          (out.at(-1)?.atoms ?? pending).push(markAtom(child, "end"));
          break;
      }
    }
  };
  visit(body, null);
  return out;
}

/** A content-free paragraph, as Word appends to a package after its last block. */
const isEmptyParagraph = (paragraph: PackageParagraph) =>
  paragraph.atoms.every(
    (atom) => atom.type === "text" && atom.text.length === 0,
  );

const COMBINATIONS: readonly (readonly [boolean, boolean])[] = [
  // Desktop shows tracked deletions but not hidden text; the web shows both.
  [false, true],
  [true, true],
  [false, false],
  [true, false],
];

/**
 * The atoms laid over paragraph.text: each atom's offset, and what each character of
 * paragraph.text is. Hidden and deleted text either all shows or all doesn't, as one host decides;
 * an opaque atom shows one character or none; a reference consumes a U+0005 when one is there.
 */
function align(
  atoms: readonly Atom[],
  rangeText: string,
): { at: number[]; kinds: CharKind[] } | null {
  const has = (key: "hidden" | "deleted") =>
    atoms.some(
      (atom) => (atom.type === "text" || atom.type === "opaque") && atom[key],
    );
  const tried = new Set<string>();
  for (const [hidden, deleted] of COMBINATIONS) {
    const key = `${hidden && has("hidden")}:${deleted && has("deleted")}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const aligned = alignWith(atoms, rangeText, hidden, deleted);
    if (aligned) return aligned;
  }
  return null;
}

function alignWith(
  atoms: readonly Atom[],
  rangeText: string,
  showHidden: boolean,
  showDeleted: boolean,
): { at: number[]; kinds: CharKind[] } | null {
  const at = new Array<number>(atoms.length);
  const kinds = new Array<CharKind>(rangeText.length);
  const failed = new Set<number>();
  const shows = (atom: { hidden: boolean; deleted: boolean }) =>
    (!atom.hidden || showHidden) && (!atom.deleted || showDeleted);
  const kindOf = (
    atom: { hidden: boolean; deleted: boolean },
    own: CharKind,
  ) => (atom.deleted ? "deleted" : atom.hidden ? "hidden" : own);
  const from = (first: number, offset: number): boolean => {
    let position = offset;
    for (let i = first; i < atoms.length; i += 1) {
      const atom = atoms[i];
      at[i] = position;
      switch (atom.type) {
        case "mark":
          if (
            atom.mark === "reference" &&
            rangeText[position] === COMMENT_ANCHOR
          )
            kinds[position++] = "mark";
          break;
        case "note":
          if (rangeText[position] === NOTE_ANCHOR) kinds[position++] = "mark";
          break;
        case "text":
          if (!shows(atom)) break;
          if (!rangeText.startsWith(atom.text, position)) return false;
          kinds.fill(
            kindOf(atom, atom.kind),
            position,
            position + atom.text.length,
          );
          position += atom.text.length;
          break;
        case "opaque": {
          if (!shows(atom)) break;
          const state = i * (rangeText.length + 1) + position;
          if (failed.has(state)) return false;
          if (from(i + 1, position)) return true;
          if (position < rangeText.length) {
            kinds[position] = kindOf(atom, "opaque");
            if (from(i + 1, position + 1)) return true;
          }
          failed.add(state);
          return false;
        }
      }
    }
    return position === rangeText.length;
  };
  return from(0, 0) ? { at, kinds } : null;
}

/**
 * Which kinds the visible text keeps. getText may or may not show a line break or an opaque item
 * as paragraph.text does, so the identity text picks the policy when it is given.
 */
const POLICIES: readonly ReadonlySet<CharKind>[] = [
  new Set(["text", "break", "opaque"]),
  new Set(["text", "opaque"]),
  new Set(["text", "break"]),
  new Set(["text"]),
];

function viewOf(
  rangeText: string,
  kinds: readonly CharKind[],
  texts: WordParagraphTexts,
): WordParagraphView | null {
  for (const policy of POLICIES) {
    const visibleAt: number[] = [];
    let visibleText = "";
    for (let i = 0; i < rangeText.length; i += 1) {
      visibleAt.push(visibleText.length);
      if (policy.has(kinds[i])) visibleText += rangeText[i];
    }
    visibleAt.push(visibleText.length);
    if (texts.identityText === undefined)
      return { rangeText, visibleText, visibleAt };
    if (
      wordIdentityShows(texts.identityText, visibleText, texts.inCell === true)
    )
      return { rangeText, visibleText, visibleAt };
  }
  return null;
}

/**
 * A paragraph's views from its text alone: paragraph.text minus U+0005 and U+0002 must spell its
 * identity text, which a tracked deletion, or hidden text on the web, prevents. The package read
 * maps those paragraphs instead.
 */
export function wordParagraphViewFromText(
  texts: WordParagraphTexts & { identityText: string },
): WordParagraphView | null {
  // Per UTF-16 unit, as paragraph.text offsets count.
  const kinds = Array.from({ length: texts.rangeText.length }, (_, i) => {
    const char = texts.rangeText[i];
    return char === COMMENT_ANCHOR || char === NOTE_ANCHOR
      ? "mark"
      : char === "\u000B"
        ? "break"
        : "text";
  }) satisfies CharKind[];
  return viewOf(texts.rangeText, kinds, texts);
}

const hexId = (value: string | null) =>
  value && /^[0-9A-Fa-f]{1,8}$/.test(value) ? value.toUpperCase() : null;

function commentText(comment: Element): string {
  return Array.from(comment.getElementsByTagNameNS(W, "p"))
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagNameNS(W, "*"))
        .map((node) =>
          node.localName === "t"
            ? (node.textContent ?? "")
            : node.localName === "tab"
              ? "\t"
              : node.localName === "br"
                ? "\n"
                : "",
        )
        .join(""),
    )
    .join("\n");
}

function packageComments(doc: Document): {
  comments: WordPackageComment[];
  hasIds: boolean;
} {
  const idsPart = doc.getElementsByTagNameNS(W16CID, "commentsIds")[0];
  const durableByParaId = new Map<string, string>();
  for (const entry of Array.from(
    idsPart?.getElementsByTagNameNS(W16CID, "commentId") ?? [],
  )) {
    const paraId = hexId(entry.getAttributeNS(W16CID, "paraId"));
    const durableId = hexId(entry.getAttributeNS(W16CID, "durableId"));
    if (paraId && durableId) durableByParaId.set(paraId, durableId);
  }
  const extended = new Map<string, { parent: string | null; done: boolean }>();
  for (const entry of Array.from(
    doc.getElementsByTagNameNS(W15, "commentEx"),
  )) {
    const paraId = hexId(entry.getAttributeNS(W15, "paraId"));
    if (paraId)
      extended.set(paraId, {
        parent: hexId(entry.getAttributeNS(W15, "paraIdParent")),
        done: entry.getAttributeNS(W15, "done") === "1",
      });
  }
  const dateUtc = new Map<string, string>();
  for (const entry of Array.from(
    doc.getElementsByTagNameNS(W16CEX, "commentExtensible"),
  )) {
    const durableId = hexId(entry.getAttributeNS(W16CEX, "durableId"));
    const utc = entry.getAttributeNS(W16CEX, "dateUtc");
    if (durableId && utc) dateUtc.set(durableId, utc);
  }
  const elements = Array.from(doc.getElementsByTagNameNS(W, "comment"));
  // A comment's thread entries, its durableId and its UTC date hang off its last paragraph.
  const paraIds = elements.map((comment) =>
    hexId(
      Array.from(comment.getElementsByTagNameNS(W, "p"))
        .at(-1)
        ?.getAttributeNS(W14, "paraId") ?? null,
    ),
  );
  const wIdByParaId = new Map<string, string>();
  elements.forEach((comment, i) => {
    const paraId = paraIds[i];
    if (paraId) wIdByParaId.set(paraId, attr(comment, "id") ?? "");
  });
  const comments = elements.map((comment, i): WordPackageComment => {
    const paraId = paraIds[i];
    const durableId = paraId ? durableByParaId.get(paraId) : undefined;
    const thread = paraId ? extended.get(paraId) : undefined;
    return {
      wId: attr(comment, "id") ?? "",
      commentId: durableId ? String(parseInt(durableId, 16)) : null,
      parentWId: thread?.parent
        ? (wIdByParaId.get(thread.parent) ?? null)
        : null,
      done: thread ? thread.done : null,
      author: attr(comment, "author") ?? "",
      initials: attr(comment, "initials") ?? "",
      date: attr(comment, "date"),
      dateUtc: (durableId && dateUtc.get(durableId)) || null,
      content: commentText(comment),
    };
  });
  return { comments, hasIds: idsPart !== undefined };
}

interface Placed {
  paragraph: PackageParagraph;
  texts: WordParagraphTexts;
  aligned: { at: number[]; kinds: CharKind[] } | null;
  view: WordParagraphView | null;
}

function spansOf(
  placed: readonly Placed[],
  comments: readonly WordPackageComment[],
): WordCommentSpan[] {
  const byWId = new Map(comments.map((comment) => [comment.wId, comment]));
  const spans = new Map<
    string,
    WordCommentSpan & { contentAtStart: number; contentAtEnd: number }
  >();
  let content = 0;
  placed.forEach(({ paragraph, aligned, view }, index) => {
    paragraph.atoms.forEach((atom, i) => {
      if (atom.type === "text" || atom.type === "opaque") {
        if (
          !atom.hidden &&
          !atom.deleted &&
          (atom.type === "opaque" || atom.text.length > 0)
        )
          content += 1;
        return;
      }
      if (atom.type !== "mark") return;
      const range = aligned ? aligned.at[i] : null;
      const edge: WordCommentEdge = {
        paragraph: index,
        range,
        visible: range !== null && view ? view.visibleAt[range] : null,
      };
      let span = spans.get(atom.wId);
      if (!span) {
        const commentId = byWId.get(atom.wId)?.commentId ?? null;
        span = {
          wId: atom.wId,
          commentId,
          joinedBy: commentId ? "durableId" : null,
          start: null,
          end: null,
          reference: null,
          point: false,
          multiCell: false,
          contentAtStart: -1,
          contentAtEnd: -1,
        };
        spans.set(atom.wId, span);
      }
      if (atom.mark === "start" && !span.start) {
        span.start = edge;
        span.contentAtStart = content;
      } else if (atom.mark === "end" && !span.end) {
        span.end = edge;
        span.contentAtEnd = content;
      } else if (atom.mark === "reference" && !span.reference) {
        span.reference = edge;
        if (!span.end) span.contentAtEnd = content;
      }
    });
  });
  return Array.from(spans.values(), (found) => {
    const { contentAtStart, contentAtEnd, ...span } = found;
    // A reference alone anchors the comment at one point; a start without an end in the same
    // package ends at its reference, or after the package when that is missing too.
    if (!span.start && !span.end && span.reference) {
      span.start = span.reference;
      span.end = span.reference;
      span.point = true;
    } else {
      if (span.start && !span.end && span.reference) span.end = span.reference;
      span.point =
        !!span.start &&
        !!span.end &&
        span.start.paragraph === span.end.paragraph &&
        contentAtStart === contentAtEnd;
    }
    if (span.start && span.end) {
      const first = placed[span.start.paragraph].paragraph.cell;
      const last = placed[span.end.paragraph].paragraph.cell;
      span.multiCell = first !== last;
    }
    return span;
  });
}

/** The read, and whether every paragraph spelled its paragraph.text. */
function readPlaced(
  doc: Document,
  paragraphs: readonly PackageParagraph[],
  texts: readonly WordParagraphTexts[],
): { read: WordCommentPackageRead; aligned: boolean } {
  const placed = paragraphs.map((paragraph, i): Placed => {
    const aligned = align(paragraph.atoms, texts[i].rangeText);
    return {
      paragraph,
      texts: texts[i],
      aligned,
      view: aligned
        ? viewOf(texts[i].rangeText, aligned.kinds, texts[i])
        : null,
    };
  });
  const { comments, hasIds } = packageComments(doc);
  const spans = spansOf(placed, comments);
  return {
    read: {
      legacy: !hasIds && (comments.length > 0 || spans.length > 0),
      comments,
      views: placed.map((p) => p.view),
      spans,
    },
    aligned: placed.every((p) => p.aligned !== null),
  };
}

/**
 * The comments of one paragraph, from its own getOoxml(). For a paragraph that ends a table cell,
 * pass its cell index: desktop answers with the whole table row. Null when the package is
 * unreadable or does not show which paragraph is meant.
 */
export function readWordCommentParagraphPackage(
  ooxml: string,
  paragraph: WordParagraphTexts & { cellIndex?: number },
): WordCommentPackageRead | null {
  const own =
    paragraph.cellIndex === undefined
      ? ooxml
      : wordCellParagraphOoxml(ooxml, paragraph.cellIndex, paragraph.rangeText);
  const doc = parse(own);
  const body = doc && mainBody(doc);
  if (!doc || !body) return null;
  const block = childrenOf(body).find((child) =>
    ["p", "tbl", "sdt", "customXml"].includes(child.localName),
  );
  if (!block) return null;
  if (!isW(block, "tbl")) {
    // Word appends an empty paragraph to a paragraph's package; the first one is the paragraph.
    const [found] = packageParagraphs(body);
    return found ? readPlaced(doc, [found], [paragraph]).read : null;
  }
  if (paragraph.cellIndex === undefined) return null;
  // wordCellParagraphOoxml proves its cut by the runs' text without tracked deletions and with
  // hidden text, while desktop's paragraph.text shows deletions and hides hidden text; here the
  // alignment with paragraph.text proves the pick instead.
  const rows = flattened(block, "tr");
  const cell =
    rows.length === 1
      ? flattened(rows[0], "tc")[paragraph.cellIndex]
      : undefined;
  const last = cell?.lastElementChild;
  if (!last || !isW(last, "p")) return null;
  const atoms: Atom[] = [];
  inlineAtoms(last, atoms);
  return readPlaced(doc, [{ atoms, cell: null }], [paragraph]).read;
}

/**
 * The comments of a range from a first to a last paragraph, from the range's getOoxml(), which
 * holds the marks of comments that span those paragraphs. `paragraphs` are the range's paragraphs
 * in document order. Desktop only: on the web, reading or selecting OOXML across paragraphs
 * rewrites the end paragraphs (ERMAIN-932), so the web takes wordCommentTextSpan instead.
 */
export function readWordCommentRangePackage(
  ooxml: string,
  paragraphs: readonly WordParagraphTexts[],
): WordCommentPackageRead | null {
  const doc = parse(ooxml);
  const body = doc && mainBody(doc);
  if (!doc || !body || paragraphs.length === 0) return null;
  const found = packageParagraphs(body);
  if (
    found.length < paragraphs.length ||
    !found.slice(paragraphs.length).every(isEmptyParagraph)
  )
    return null;
  // Only paragraphs that spell their paragraph.text prove that marks land on the right paragraph.
  const { read, aligned } = readPlaced(
    doc,
    found.slice(0, paragraphs.length),
    paragraphs,
  );
  return aligned ? read : null;
}

/** Office.js's view of a comment, for the content join. */
export interface WordListedComment {
  /** String(Comment.id) */
  id: string;
  content: string;
  /** Comment.getRange().text */
  rangeText?: string;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The span's anchored text inside one paragraph, when its offsets are known. */
function spanText(
  read: WordCommentPackageRead,
  span: WordCommentSpan,
): string | null {
  const { start, end } = span;
  if (!start || !end || start.paragraph !== end.paragraph) return null;
  const view = read.views[start.paragraph];
  if (!view || start.visible === null || end.visible === null) return null;
  return view.visibleText.slice(start.visible, end.visible);
}

/**
 * The legacy fallback (contract §4.5): a file without commentsIds names no comment, so each span
 * the package could not join is matched to a listed comment of the same paragraph by its content
 * and anchored text. Equal ones pair up in order; `listed` must be in document order, never in
 * items order (F-10). A group whose counts or anchors disagree stays unjoined.
 */
export function joinWordCommentSpansByContent(
  read: WordCommentPackageRead,
  listed: readonly WordListedComment[],
): WordCommentSpan[] {
  const byWId = new Map(read.comments.map((c) => [c.wId, c]));
  const taken = new Set(
    read.spans.flatMap((span) => (span.commentId ? [span.commentId] : [])),
  );
  const open = read.spans.filter((span) => !span.commentId);
  const groups = new Map<
    string,
    { spans: WordCommentSpan[]; listed: WordListedComment[] }
  >();
  const group = (key: string) => {
    const found = groups.get(key) ?? { spans: [], listed: [] };
    groups.set(key, found);
    return found;
  };
  for (const span of open) {
    const comment = byWId.get(span.wId);
    if (comment) group(squash(comment.content)).spans.push(span);
  }
  for (const comment of listed)
    if (!taken.has(comment.id))
      group(squash(comment.content)).listed.push(comment);
  const joined = new Map<WordCommentSpan, string>();
  for (const { spans, listed: candidates } of groups.values()) {
    if (spans.length === 0 || spans.length !== candidates.length) continue;
    const agrees = spans.every((span, i) => {
      const ours = spanText(read, span);
      const theirs = candidates[i].rangeText;
      return (
        ours === null ||
        theirs === undefined ||
        squash(ours) === squash(theirs.replace(ANCHOR_MARKS, ""))
      );
    });
    if (agrees) spans.forEach((span, i) => joined.set(span, candidates[i].id));
  }
  return read.spans.map((span) => {
    const id = joined.get(span);
    return id ? { ...span, commentId: id, joinedBy: "content" } : span;
  });
}

/** Offsets in the first and last paragraph's paragraph.text; equal paragraphs for one paragraph. */
export interface WordCommentTextSpan {
  start: number;
  end: number;
}

/** A reference's U+0005 at the end belongs to the balloon anchor, not to the anchored text. */
function withoutTrailingAnchors(text: string, end: number): number {
  let at = end;
  while (at > 0 && text[at - 1] === COMMENT_ANCHOR) at -= 1;
  return at;
}

/**
 * Where a comment lies by text arithmetic on Comment.getRange().text. Within one paragraph its text
 * must occur exactly once in paragraph.text. Across paragraphs, the range's first line must end the
 * first paragraph and its last line begin the last one; a text that ends in a paragraph mark runs
 * through the last paragraph's end, or stops where it starts. Null when that is not unique.
 */
export function wordCommentTextSpan(
  text: string,
  first: string,
  last?: string,
): WordCommentTextSpan | null {
  if (last === undefined) {
    const own = text.replace(PARAGRAPH_MARKS, "");
    if (!own) return null;
    const start = first.indexOf(own);
    if (start < 0 || first.indexOf(own, start + 1) >= 0) return null;
    return { start, end: withoutTrailingAnchors(first, start + own.length) };
  }
  // The first line ends at a separator k, and is then the tail of the first paragraph.
  const starts: number[] = [];
  for (let k = 0; k <= Math.min(first.length, text.length - 1); k += 1)
    if (SEPARATORS.has(text[k]) && first.endsWith(text.slice(0, k)))
      starts.push(first.length - k);
  if (starts.length !== 1) return null;
  const firstLength = first.length - starts[0];
  // The last line starts after a separator j, past the first line, and heads the last paragraph.
  const ends = (whole: string) => {
    const found: number[] = [];
    for (
      let j = whole.length - 2;
      j >= Math.max(firstLength, whole.length - 1 - last.length);
      j -= 1
    )
      if (SEPARATORS.has(whole[j]) && last.startsWith(whole.slice(j + 1)))
        found.push(whole.length - j - 1);
    return found;
  };
  const direct = ends(text);
  if (direct.length > 1) return null;
  if (direct.length === 1)
    return { start: starts[0], end: withoutTrailingAnchors(last, direct[0]) };
  const marked = text.replace(PARAGRAPH_MARKS, "");
  if (marked.length === text.length) return null;
  const end = ends(marked).includes(last.length) ? last.length : 0;
  return { start: starts[0], end: withoutTrailingAnchors(last, end) };
}

/** The visible view of quotes: normalised like the review facet's text, and the map into it. */
function normalized(plain: string): {
  text: string;
  at: (i: number) => number;
} {
  const collapsed: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < plain.length; ) {
    map.push(collapsed.length);
    if (/[\r\n\u000B]/.test(plain[i])) {
      let j = i + 1;
      while (j < plain.length && /[\r\n\u000B]/.test(plain[j])) {
        map.push(collapsed.length);
        j += 1;
      }
      collapsed.push(" ");
      i = j;
    } else {
      collapsed.push(plain[i]);
      i += 1;
    }
  }
  map.push(collapsed.length);
  const joined = collapsed.join("");
  const text = normalizeParagraphText(plain);
  const lead = joined.length - joined.trimStart().length;
  return {
    text,
    at: (i) =>
      Math.min(Math.max((map[i] ?? joined.length) - lead, 0), text.length),
  };
}

const quoteOf = (text: string) =>
  normalizeParagraphText(text.replace(ANCHOR_MARKS, ""));

/** At most `limit` characters from the start, without a cut word at the end when one fits. */
function head(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.search(/\s\S*$/);
  return (
    /\s/.test(text[limit]) || space <= 0 ? cut : cut.slice(0, space)
  ).trimEnd();
}

/** At most `limit` characters from the end, without a cut word at the start when one fits. */
function tail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(-limit);
  const space = cut.search(/\s/);
  return (
    /\s/.test(text[text.length - limit - 1]) ||
    space < 0 ||
    space === cut.length - 1
      ? cut
      : cut.slice(space + 1)
  ).trimStart();
}

/** The anchor fields the model sees; para, through and in come from the paragraph inventory. */
export type WordCommentAnchorText = Pick<
  WordCommentWhere,
  "quote" | "occurrence" | "point" | "after" | "multi_cell" | "position"
>;

export type WordCommentAnchorSource =
  /** Visible offsets in one paragraph; start === end is a point comment. */
  | { kind: "paragraph"; visible: string; start: number; end: number }
  /** From a visible offset in the first paragraph to one in the last. */
  | {
      kind: "paragraphs";
      first: string;
      start: number;
      last: string;
      end: number;
      multiCell?: boolean;
    }
  /** No offsets: the quote comes from Comment.getRange().text, and the position is unknown. */
  | { kind: "unplaced"; rangeText: string };

/**
 * The anchor as the model sees it (contract §5): the quote in the visible text with an occurrence
 * only when it repeats in the paragraph; "start…end" across paragraphs, with multi_cell across
 * cells; up to 20 visible characters before a point comment. `edgeChars` shortens each end of a
 * multi-paragraph quote.
 */
export function wordCommentAnchorText(
  source: WordCommentAnchorSource,
  options: { edgeChars?: number } = {},
): WordCommentAnchorText {
  if (source.kind === "unplaced") {
    const lines = source.rangeText
      .replace(ANCHOR_MARKS, "")
      .split(LINES)
      .filter((line) => line.trim());
    const quote =
      lines.length > 1
        ? `${quoteOf(lines[0])}${ELLIPSIS}${quoteOf(lines[lines.length - 1])}`
        : quoteOf(lines[0] ?? "");
    return { quote, position: "unknown" };
  }
  if (source.kind === "paragraphs") {
    const edge = options.edgeChars ?? Infinity;
    const start = head(quoteOf(source.first.slice(source.start)), edge);
    const end = tail(quoteOf(source.last.slice(0, source.end)), edge);
    return {
      quote: `${start}${ELLIPSIS}${end}`,
      ...(source.multiCell ? { multi_cell: true } : {}),
    };
  }
  const { visible, start, end } = source;
  if (start === end) {
    const after = tail(quoteOf(visible.slice(0, start)), AFTER_CHARS);
    return { quote: "", point: true, ...(after ? { after } : {}) };
  }
  const paragraph = normalized(visible);
  const raw = paragraph.text.slice(paragraph.at(start), paragraph.at(end));
  const quote = raw.trim();
  if (!quote) return { quote, position: "unknown" };
  const quoteStart =
    paragraph.at(start) + (raw.length - raw.trimStart().length);
  let count = 0;
  let ours = 0;
  for (
    let found = paragraph.text.indexOf(quote);
    found >= 0;
    found = paragraph.text.indexOf(quote, found + quote.length)
  ) {
    count += 1;
    if (found === quoteStart) ours = count;
  }
  // Word's search finds the same non-overlapping hits; one that overlaps another is not among them.
  if (!ours) return { quote, position: "unknown" };
  return count > 1 ? { quote, occurrence: ours } : { quote };
}

/** The anchor source of a span the package placed, or an unplaced one from its range text. */
export function wordCommentSpanSource(
  read: WordCommentPackageRead,
  span: WordCommentSpan,
  rangeText = "",
): WordCommentAnchorSource {
  const { start, end } = span;
  const first = start && read.views[start.paragraph];
  const last = end && read.views[end.paragraph];
  if (
    !start ||
    !end ||
    !first ||
    !last ||
    start.visible === null ||
    end.visible === null
  )
    return { kind: "unplaced", rangeText };
  return start.paragraph === end.paragraph
    ? {
        kind: "paragraph",
        visible: first.visibleText,
        start: start.visible,
        end: end.visible,
      }
    : {
        kind: "paragraphs",
        first: first.visibleText,
        start: start.visible,
        last: last.visibleText,
        end: end.visible,
        ...(span.multiCell ? { multiCell: true } : {}),
      };
}

/**
 * The text route in one step (web, and the fallback everywhere): Comment.getRange().text against
 * the first and last paragraph's views. `last` is absent for an anchor inside one paragraph.
 */
export function wordCommentTextSource(
  rangeText: string,
  first: WordParagraphView | null,
  last?: WordParagraphView | null,
  multiCell = false,
): WordCommentAnchorSource {
  const unplaced = { kind: "unplaced", rangeText } as const;
  if (!first || last === null) return unplaced;
  const span = wordCommentTextSpan(rangeText, first.rangeText, last?.rangeText);
  if (!span) return unplaced;
  if (!last)
    return {
      kind: "paragraph",
      visible: first.visibleText,
      start: first.visibleAt[span.start],
      end: first.visibleAt[span.end],
    };
  return {
    kind: "paragraphs",
    first: first.visibleText,
    start: first.visibleAt[span.start],
    last: last.visibleText,
    end: last.visibleAt[span.end],
    ...(multiCell ? { multiCell: true } : {}),
  };
}
