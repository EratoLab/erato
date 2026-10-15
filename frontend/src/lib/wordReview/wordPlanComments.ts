import { effectiveWordMediaChildren } from "./wordMediaComparison";
import { isWordTextHidden, nativeVisibleText } from "./wordNativeContent";

/**
 * Comment threads as a captured or compiled package holds them, for what a document plan does to
 * them (ERMAIN-950, contract §13.1). Plans never write comments, but a plan that removes all of a
 * thread's anchor text removes the thread (F-8), so the card lists those threads and Apply needs
 * the user's tick for them.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";

export interface WordPlanCommentEntry {
  /** Package-local w:id; Word renumbers it on export, so it names a comment within one package only. */
  wId: string;
  /** String(Comment.id): commentsIds' durableId in decimal; null in a file without one. */
  commentId: string | null;
  author: string;
  /** w:date as written, "" when absent. */
  date: string;
  text: string;
}

export interface WordPlanCommentThread extends WordPlanCommentEntry {
  resolved: boolean;
  /** The anchored text, whitespace squashed; "" for a point comment. */
  quote: string;
  replies: WordPlanCommentEntry[];
}

/** One row per thread a plan removes: the root and its replies go together. */
export interface WordPlanCommentRemoval {
  thread: WordPlanCommentThread;
  /** "anchor": the plan removes its anchor marks; "text": the marks stay around no text, and
   * Word deletes such a comment as soon as its text is gone (F-8). */
  cause: "anchor" | "text";
}

const isW = (e: Element, local: string) =>
  e.namespaceURI === W && e.localName === local;
const attr = (e: Element, ns: string, local: string) =>
  e.getAttributeNS(ns, local) ?? "";
const hex = (value: string) =>
  /^[0-9A-Fa-f]{1,8}$/.test(value) ? value.toUpperCase() : "";
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function partRoot(doc: Document, name: string): Element | undefined {
  const part = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (p) => p.getAttributeNS(PKG, "name") === name,
  );
  const data = part
    ? Array.from(part.children).find(
        (e) => e.namespaceURI === PKG && e.localName === "xmlData",
      )
    : undefined;
  return data?.firstElementChild ?? undefined;
}

function commentElements(doc: Document): Element[] {
  const root = partRoot(doc, "/word/comments.xml");
  return root ? Array.from(root.children).filter((e) => isW(e, "comment")) : [];
}

/** A comment's thread entries hang off its last paragraph's w14:paraId. */
const paraIdOf = (comment: Element) =>
  hex(
    Array.from(comment.getElementsByTagNameNS(W, "p"))
      .at(-1)
      ?.getAttributeNS(W14, "paraId") ?? "",
  );

/**
 * Each comment's thread root by w:id, from commentsExtended's paraIdParent; a comment without a
 * resolvable parent is its own root. Replies are flat in Word, but a chain is followed to its top.
 */
export function wordCommentThreadRoots(doc: Document): Map<string, string> {
  const comments = commentElements(doc);
  const wIdByPara = new Map<string, string>();
  for (const comment of comments) {
    const para = paraIdOf(comment);
    if (para) wIdByPara.set(para, attr(comment, W, "id"));
  }
  const parent = new Map<string, string>();
  for (const entry of Array.from(
    doc.getElementsByTagNameNS(W15, "commentEx"),
  )) {
    const child = wIdByPara.get(hex(attr(entry, W15, "paraId")));
    const of = wIdByPara.get(hex(attr(entry, W15, "paraIdParent")));
    if (child !== undefined && of !== undefined && of !== child)
      parent.set(child, of);
  }
  const roots = new Map<string, string>();
  for (const comment of comments) {
    const id = attr(comment, W, "id");
    let root = id;
    const seen = new Set([id]);
    for (let up = parent.get(root); up !== undefined; up = parent.get(root)) {
      if (seen.has(up)) break;
      seen.add(up);
      root = up;
    }
    roots.set(id, root);
  }
  return roots;
}

interface WordCommentAnchor {
  text: string;
  /** Both range marks are in the body. */
  ranged: boolean;
  referenced: boolean;
  /** Position of its first mark in document order. */
  order: number;
}

/** The visible text inside each comment's range, as nativeVisibleText counts it, plus its marks. */
function wordCommentAnchors(doc: Document): Map<string, WordCommentAnchor> {
  const anchors = new Map<string, WordCommentAnchor>();
  const body = partRoot(doc, "/word/document.xml");
  if (!body) return anchors;
  const open = new Set<string>();
  const starts = new Set<string>();
  let order = 0;
  const anchor = (id: string) => {
    let found = anchors.get(id);
    if (!found) {
      found = { text: "", ranged: false, referenced: false, order: order++ };
      anchors.set(id, found);
    }
    return found;
  };
  const write = (text: string) => {
    for (const id of open) anchor(id).text += text;
  };
  const visit = (e: Element, hidden: boolean) => {
    if (e.namespaceURI === W) {
      const id = attr(e, W, "id");
      if (e.localName === "commentRangeStart") {
        anchor(id);
        open.add(id);
        starts.add(id);
        return;
      }
      if (e.localName === "commentRangeEnd") {
        if (starts.has(id)) anchor(id).ranged = true;
        open.delete(id);
        return;
      }
      if (e.localName === "commentReference") {
        anchor(id).referenced = true;
        return;
      }
      if (isWordTextHidden(e)) hidden = true;
      if (!hidden && e.localName === "t") write(e.textContent ?? "");
      if (!hidden && e.localName === "tab") write("\t");
      if (!hidden && ["br", "cr"].includes(e.localName)) write("\n");
    }
    for (const child of effectiveWordMediaChildren(e)) visit(child, hidden);
    if (isW(e, "p")) write("\n");
  };
  visit(body, false);
  return anchors;
}

function entryOf(
  comment: Element,
  durable: ReadonlyMap<string, string>,
): WordPlanCommentEntry {
  const id = durable.get(paraIdOf(comment));
  return {
    wId: attr(comment, W, "id"),
    commentId: id ? String(parseInt(id, 16)) : null,
    author: attr(comment, W, "author"),
    date: attr(comment, W, "date"),
    text: nativeVisibleText(comment),
  };
}

/** Every thread in the package, in document order of its anchor; unanchored threads last. */
export function wordPlanCommentThreads(doc: Document): WordPlanCommentThread[] {
  const comments = commentElements(doc);
  if (!comments.length) return [];
  const durable = new Map<string, string>();
  for (const entry of Array.from(
    doc.getElementsByTagNameNS(W16CID, "commentId"),
  )) {
    const para = hex(attr(entry, W16CID, "paraId"));
    const id = hex(attr(entry, W16CID, "durableId"));
    if (para && id) durable.set(para, id);
  }
  const done = new Map<string, boolean>();
  for (const entry of Array.from(doc.getElementsByTagNameNS(W15, "commentEx")))
    done.set(
      hex(attr(entry, W15, "paraId")),
      ["1", "true", "on"].includes(attr(entry, W15, "done")),
    );
  const roots = wordCommentThreadRoots(doc);
  const anchors = wordCommentAnchors(doc);
  const threads = new Map<string, WordPlanCommentThread>();
  for (const comment of comments) {
    const id = attr(comment, W, "id");
    if (roots.get(id) !== id) continue;
    threads.set(id, {
      ...entryOf(comment, durable),
      resolved: done.get(paraIdOf(comment)) ?? false,
      quote: squash(anchors.get(id)?.text ?? ""),
      replies: [],
    });
  }
  for (const comment of comments) {
    const id = attr(comment, W, "id");
    const root = roots.get(id);
    if (root !== id && root !== undefined)
      threads.get(root)?.replies.push(entryOf(comment, durable));
  }
  const rank = (thread: WordPlanCommentThread) =>
    anchors.get(thread.wId)?.order ?? Number.MAX_SAFE_INTEGER;
  return [...threads.values()].sort((a, b) => rank(a) - rank(b));
}

/**
 * The threads, read from the captured package, that a compile to `after` removes: those whose
 * comment is gone, and those whose range marks stay around no visible text, which Word removes on
 * its own (F-8). A point comment keeps no text in its range, so only its reference decides.
 */
export function wordPlanCommentRemovals(
  threads: readonly WordPlanCommentThread[],
  after: Document,
): WordPlanCommentRemoval[] {
  if (!threads.length) return [];
  const present = new Set(
    commentElements(after).map((comment) => attr(comment, W, "id")),
  );
  const anchors = wordCommentAnchors(after);
  return threads.flatMap((thread): WordPlanCommentRemoval[] => {
    if (!present.has(thread.wId)) return [{ thread, cause: "anchor" }];
    const anchor = anchors.get(thread.wId);
    return thread.quote && anchor?.ranged && !anchor.text.trim()
      ? [{ thread, cause: "text" }]
      : [];
  });
}

/** What a plan must leave alone on every comment it keeps, and the people part, as written. */
export interface WordCommentAttribution {
  comments: ReadonlyMap<
    string,
    readonly [string | null, string | null, string | null]
  >;
  people: string | null;
}

export function wordCommentAttribution(doc: Document): WordCommentAttribution {
  const people = partRoot(doc, "/word/people.xml");
  return {
    comments: new Map(
      commentElements(doc).map((comment) => [
        attr(comment, W, "id"),
        [
          comment.getAttributeNS(W, "author"),
          comment.getAttributeNS(W, "initials"),
          comment.getAttributeNS(W, "date"),
        ] as const,
      ]),
    ),
    people: people ? new XMLSerializer().serializeToString(people) : null,
  };
}

/**
 * Contract §13.1.4: every comment a compile keeps has the same w:author, w:initials and w:date, and
 * people.xml is unchanged; none of them is Word housekeeping. A removed comment is not compared.
 */
export function wordCommentAttributionChanged(
  before: WordCommentAttribution,
  after: WordCommentAttribution,
): boolean {
  if (before.people !== after.people) return true;
  for (const [id, fields] of after.comments) {
    const original = before.comments.get(id);
    if (!original || fields.some((value, i) => value !== original[i]))
      return true;
  }
  return false;
}
