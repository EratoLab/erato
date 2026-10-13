import { vi } from "vitest";

import {
  V3C_COMMENTS,
  V3C_PARAGRAPHS,
  v3cParagraphPackage,
  v3cRangePackage,
  v3cRowPackage,
} from "./commentPackages";
import { escapeXml } from "../../../utils/escapeXml";

import type { V3cComment, V3cPackageOptions } from "./commentPackages";
import type { Mock } from "vitest";

/**
 * A Word host for comment reads (ERMAIN-948): body.getComments(), replies, Comment.getRange(),
 * paragraphs, compareLocationWith and getOoxml(), as the ERMAIN-947 probe measured them per host.
 * office-addin-mock cannot model collections, so this is hand-written, and kept apart from
 * selectionHost.ts. Calls queue commands that run at context.sync(); properties must be loaded
 * before they are read; a command that throws rejects its sync.
 *
 * Per host (probe report, Tier 2):
 * - pc, mac: Comment.id is a string; items come in end-mark order; creationDate is dateUtc cut to
 *   the minute, or w:date read in the host's zone (UTC+2) without one.
 * - web: Comment.id is a number; items come in start order; creationDate keeps seconds, and is
 *   null without dateUtc; paragraph.text shows U+0005 at references and hidden text; a comment's
 *   range text ends in its U+0005 and joins cells with "\r"; `repliesWithRoot` models comments.xml
 *   out of w:id order, where replies list the root and drop a real reply; reading the range of a
 *   comment whose paragraph has hidden text unhides it (gate F1), which `unhidden()` reports.
 */

export type CommentHostFlavour = "pc" | "mac" | "web";

type Segment = (typeof V3C_PARAGRAPHS)[string][number];

export interface CommentHostParagraph {
  tag: string;
  segments: readonly Segment[];
  /** Paragraph.styleBuiltIn, such as "Heading1". */
  style?: string;
}

export type CommentHostBlock =
  | CommentHostParagraph
  /** One array per row. */
  | { table: readonly (readonly CommentHostParagraph[])[] };

export interface CommentHostDocument {
  body: readonly CommentHostBlock[];
  /** Roots and replies; a reply names its root in `parent`. Key order is w:id order. */
  comments: Readonly<Record<string, V3cComment>>;
  /** Author name → Entra email. */
  emails?: Readonly<Record<string, string>>;
  /** Paragraph and range packages come from commentPackages.ts; otherwise they carry no comments. */
  v3c?: boolean;
}

const v3c = (tag: string): CommentHostParagraph => ({
  tag,
  segments: V3C_PARAGRAPHS[tag],
});
const plain = (
  tag: string,
  text: string,
  style?: string,
): CommentHostParagraph => ({ tag, segments: [text], style });

/** The probe fixture v3c-comments.docx, with headings around its paragraphs. */
export const V3C_COMMENT_DOCUMENT: CommentHostDocument = {
  v3c: true,
  comments: V3C_COMMENTS,
  body: [
    plain("H1", "Introduction", "Heading1"),
    v3c("T1P"),
    v3c("T2P"),
    plain("H2", "Spans and cells", "Heading2"),
    v3c("T3A"),
    v3c("T3B"),
    v3c("T3C"),
    { table: [[v3c("T4C"), v3c("CI1")]] },
    plain("H3", "Inline anchors", "Heading2"),
    v3c("T5P"),
    v3c("T6P"),
    v3c("T8P"),
    v3c("T9P"),
    v3c("T10P"),
    v3c("T11P"),
    v3c("PB1"),
    { table: [[v3c("XC1"), v3c("XC2")]] },
    plain("END", "The end."),
  ],
};

export interface GeneratedCommentDocumentOptions {
  paragraphs: number;
  repliesPerThread?: number;
  author?: string;
  email?: string;
  /** The text of paragraph i (1-based) before its anchor. */
  text?: (i: number) => string;
  /** The anchored text of paragraph i. */
  anchor?: (i: number) => string;
  content?: (i: number) => string;
}

/** One paragraph per thread, each anchored on the word "anchor N" inside it. */
export function generatedCommentDocument(
  options: GeneratedCommentDocumentOptions,
): CommentHostDocument {
  const author = options.author ?? "Generated Author";
  const comments: Record<string, V3cComment> = {};
  const body: CommentHostParagraph[] = [];
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, "0");
  for (let i = 1; i <= options.paragraphs; i += 1) {
    const key = `G${i}`;
    const lead = options.text?.(i) ?? `G${i} Paragraph`;
    body.push({
      tag: key,
      segments: [
        `${lead} `,
        { cs: key },
        options.anchor?.(i) ?? `anchor ${i}`,
        { ce: key },
        " end.",
      ],
    });
    const minute = String(i % 60).padStart(2, "0");
    comments[key] = {
      author,
      initials: "GA",
      paraId: hex(0x10000000 + i * 4),
      durableId: hex(0x01000000 + i * 4),
      date: `2026-09-01T10:${minute}:30Z`,
      dateUtc: `2026-09-01T08:${minute}:30Z`,
      done: i % 5 === 0,
      content: options.content?.(i) ?? `Comment ${i}.`,
    };
    for (let r = 1; r <= (options.repliesPerThread ?? 0); r += 1)
      comments[`${key}r${r}`] = {
        ...comments[key],
        paraId: hex(0x10000000 + i * 4 + r),
        durableId: hex(0x01000000 + i * 4 + r),
        parent: key,
        content: `${comments[key].content} Reply ${r}.`,
      };
  }
  return {
    body,
    comments,
    ...(options.email ? { emails: { [author]: options.email } } : {}),
  };
}

export interface CommentHostOptions {
  host?: CommentHostFlavour;
  document?: CommentHostDocument;
  /**
   * No commentsIds, commentsExtensible or dateUtc in the file: ids change per open (F-2a), and
   * packages carry the session's ids as desktop's do (gate F2); the web's carry other ids, which
   * this host does not model.
   */
  legacy?: boolean;
  /** Which open of a legacy file this is: each open gives its comments other ids. */
  open?: number;
  nullParagraphIds?: boolean;
  /** Lists the comments in a seeded shuffle of the host's own order. */
  shuffle?: number;
  repliesWithRoot?: readonly string[];
  /** Loading these threads' replies throws (#3608). */
  failReplies?: readonly string[];
  /** Reading these comments' ranges throws. */
  failRanges?: readonly string[];
  /** body.getComments() throws. */
  failList?: boolean;
  /** The message of injected Office errors, which may quote the document as hosts sometimes do. */
  errorMessage?: string;
  /**
   * The user's selection, by paragraph tag and offset in that host's paragraph.text; a caret when it
   * has no `to`. Without it the whole body is selected.
   */
  selection?: CommentHostSelection;
}

export interface CommentHostPoint {
  tag: string;
  offset: number;
}

export interface CommentHostSelection extends CommentHostPoint {
  to?: CommentHostPoint;
}

export interface CommentHostSync {
  index: number;
  calls: string[];
  /** Distinct comments whose range or replies the sync read. */
  comments: number;
}

export interface CommentHost {
  syncCount(): number;
  syncLog(): CommentHostSync[];
  /** Office.js calls by name, in call order. */
  calls(): string[];
  /** The fake clock, in ms. */
  now(): number;
  /** What Comment.id returns, in the order the host lists comments. */
  listedIds(): (string | number)[];
  /** Comment keys whose getRange() was called, in call order. */
  rangesRead(): string[];
  /** Paragraphs whose hidden text a comment range read unhid on the web (gate F1). */
  unhidden(): string[];
  /** String(Comment.id) of a comment key. */
  commentId(key: string): string;
  ordinalOf(tag: string): number;
  /** What range.select() selected last, by paragraph tag and offset in paragraph.text. */
  selected(): CommentHostSpan | null;
  /** A thread's anchor in the same terms. */
  anchorOf(key: string): CommentHostSpan;
  getFileAsync: Mock;
}

export interface CommentHostSpan {
  first: string;
  last: string;
  from: number;
  to: number;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const MAIN =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const PLATFORM: Record<CommentHostFlavour, string> = {
  pc: "PC",
  mac: "Mac",
  web: "OfficeOnline",
};
const HOST_ZONE = "+02:00";

function officeError(code: string, message: string) {
  return Object.assign(new Error(message), {
    name: "RichApi.Error",
    code,
    debugInfo: { code, message },
  });
}

interface Command {
  run: () => void;
  cost: number;
  call: string;
  comment?: string;
}

interface Laid {
  rangeText: string;
  visible: string;
  hidden: boolean;
  /** getText() with these of Word.GetTextOptions. */
  shown: (options?: {
    IncludeHiddenText?: boolean;
    IncludeTextMarkedAsDeleted?: boolean;
  }) => string;
  starts: Map<string, number>;
  ends: Map<string, number>;
}

/** paragraph.text and the marks' offsets in it, as v3cRangeText spells it per host. */
function lay(segments: readonly Segment[], web: boolean): Laid {
  let rangeText = "";
  let visible = "";
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  const shown: Laid["shown"] = (options = {}) =>
    segments
      .map((segment) =>
        typeof segment === "string"
          ? segment
          : "hidden" in segment
            ? options.IncludeHiddenText
              ? segment.hidden
              : ""
            : "del" in segment && options.IncludeTextMarkedAsDeleted
              ? segment.del
              : "",
      )
      .join("");
  for (const segment of segments) {
    if (typeof segment === "string") {
      rangeText += segment;
      visible += segment;
    } else if ("hidden" in segment) {
      if (web) rangeText += segment.hidden;
    } else if ("del" in segment) rangeText += segment.del;
    else if ("cs" in segment) starts.set(segment.cs, rangeText.length);
    else if ("ce" in segment) {
      ends.set(segment.ce, rangeText.length);
      if (web) rangeText += "\u0005";
    } else if ("point" in segment) {
      starts.set(segment.point, rangeText.length);
      ends.set(segment.point, rangeText.length);
      if (web) rangeText += "\u0005";
    }
  }
  return {
    rangeText,
    visible,
    hidden: segments.some((s) => typeof s !== "string" && "hidden" in s),
    shown,
    starts,
    ends,
  };
}

interface Para {
  index: number;
  tag: string;
  style: string;
  laid: Laid;
  /** Global offset of the paragraph's start; its mark ends at base + length + 1. */
  base: number;
  cell: { table: number; row: number; cell: number; rowTags: string[] } | null;
}

interface Span {
  s: number;
  e: number;
  first: number;
  last: number;
}

function relation(a: Span, b: Span): string {
  const [s1, e1, s2, e2] = [a.s, a.e, b.s, b.e];
  if (s1 === s2 && e1 === e2) return "Equal";
  if (s1 <= s2 && e1 >= e2)
    return s1 === s2 ? "ContainsStart" : e1 === e2 ? "ContainsEnd" : "Contains";
  if (s1 >= s2 && e1 <= e2)
    return s1 === s2 ? "InsideStart" : e1 === e2 ? "InsideEnd" : "Inside";
  if (e1 <= s2) return e1 === s2 ? "AdjacentBefore" : "Before";
  if (s1 >= e2) return s1 === e2 ? "AdjacentAfter" : "After";
  return s1 < s2 ? "OverlapsBefore" : "OverlapsAfter";
}

function plainPackage(texts: readonly string[]): string {
  const body = texts
    .map(
      (text) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join("");
  return `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="${PKG}"><pkg:part pkg:name="/word/document.xml" pkg:contentType="${MAIN}"><pkg:xmlData><w:document xmlns:w="${W}"><w:body>${body}<w:p/><w:sectPr/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
}

/** A seeded Fisher–Yates shuffle. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const defaultEmail = (author: string) =>
  `${author
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")}@contoso.test`;

let teardown: (() => void) | undefined;

export function installWordCommentHost(
  options: CommentHostOptions = {},
): CommentHost {
  uninstallWordCommentHost();
  const flavour = options.host ?? "pc";
  const web = flavour === "web";
  const document = options.document ?? V3C_COMMENT_DOCUMENT;
  // Fake milliseconds: per sync, per package read, per reply listed, per compareLocationWith.
  const costs = {
    sync: 10,
    ooxml: web ? 700 : 25,
    reply: flavour === "mac" ? 90 : 5,
    compare: 0,
  };
  const message = options.errorMessage ?? "The operation failed.";
  const packageOptions: V3cPackageOptions = options.legacy
    ? {
        legacy: true,
        sessionIds: (key) =>
          Number(idOf(key)).toString(16).toUpperCase().padStart(8, "0"),
      }
    : {};

  const paragraphs: Para[] = [];
  let tables = 0;
  const push = (spec: CommentHostParagraph, cell: Para["cell"]) =>
    paragraphs.push({
      index: paragraphs.length,
      tag: spec.tag,
      style: spec.style ?? "Normal",
      laid: lay(spec.segments, web),
      base: 0,
      cell,
    });
  for (const block of document.body) {
    if (!("table" in block)) {
      push(block, null);
      continue;
    }
    tables += 1;
    block.table.forEach((row, r) =>
      row.forEach((spec, c) =>
        push(spec, {
          table: tables,
          row: r,
          cell: c,
          rowTags: row.map((s) => s.tag),
        }),
      ),
    );
  }
  let offset = 0;
  for (const p of paragraphs) {
    p.base = offset;
    offset += p.laid.rangeText.length + 1;
  }
  const byTag = new Map(paragraphs.map((p) => [p.tag, p]));

  const keys = Object.keys(document.comments);
  const roots = keys.filter((key) => !document.comments[key].parent);
  const anchors = new Map<string, Span>();
  for (const key of roots) {
    const first = paragraphs.find((p) => p.laid.starts.has(key));
    const last = paragraphs.find((p) => p.laid.ends.has(key));
    if (!first || !last) continue;
    anchors.set(key, {
      s: first.base + (first.laid.starts.get(key) ?? 0),
      e: last.base + (last.laid.ends.get(key) ?? 0),
      first: first.index,
      last: last.index,
    });
  }
  const threads = roots.filter((key) => anchors.has(key));
  const hostOrder = [...threads].sort((a, b) => {
    const x = anchors.get(a)!;
    const y = anchors.get(b)!;
    return (web ? x.s - y.s : x.e - y.e) || keys.indexOf(a) - keys.indexOf(b);
  });
  const listed =
    options.shuffle === undefined
      ? hostOrder
      : shuffled(hostOrder, options.shuffle);

  const idOf = (key: string): string =>
    options.legacy
      ? String(
          9_000_000 + (options.open ?? 0) * 1000 + keys.indexOf(key) * 7 + 3,
        )
      : String(parseInt(document.comments[key].durableId, 16));
  const officeId = (key: string) => (web ? Number(idOf(key)) : idOf(key));
  const dateOf = (comment: V3cComment): Date | null => {
    if (comment.dateUtc && !options.legacy) {
      const date = new Date(comment.dateUtc);
      if (!web) date.setUTCSeconds(0, 0);
      return date;
    }
    return web ? null : new Date(comment.date.replace(/Z$/, HOST_ZONE));
  };
  const emailOf = (author: string) =>
    document.emails?.[author] ?? defaultEmail(author);
  const repliesOf = (root: string) => {
    const replies = keys.filter((k) => document.comments[k].parent === root);
    return web && options.repliesWithRoot?.includes(root)
      ? [root, ...replies.slice(0, -1)]
      : replies;
  };

  let queue: Command[] = [];
  /** What range.select() selected last; getSelection() then returns it. */
  let selected: Span | null = null;
  let syncs = 0;
  let clock = 0;
  const callLog: string[] = [];
  const rangeLog: string[] = [];
  const unhid = new Set<string>();
  const syncEntries: CommentHostSync[] = [];
  const enqueue = (command: Command) => {
    callLog.push(command.call);
    queue.push(command);
  };
  const sync = async () => {
    syncs += 1;
    const commands = queue;
    queue = [];
    clock += costs.sync + commands.reduce((sum, c) => sum + c.cost, 0);
    syncEntries.push({
      index: syncs,
      calls: commands.map((c) => c.call),
      comments: new Set(commands.flatMap((c) => (c.comment ? [c.comment] : [])))
        .size,
    });
    for (const command of commands) command.run();
  };

  class Loadable {
    private readonly values = new Map<string, unknown>();
    constructor(
      private readonly props: Record<string, () => unknown>,
      private readonly label: string,
      private readonly failure?: () => Error | null,
      private readonly comment?: string,
    ) {
      for (const name of Object.keys(props))
        Object.defineProperty(this, name, {
          get: () => {
            if (!this.values.has(name))
              throw officeError(
                "PropertyNotLoaded",
                `mock: ${label}.${name} is not loaded`,
              );
            return this.values.get(name);
          },
        });
    }

    fill(names: readonly string[]) {
      const error = this.failure?.();
      if (error) throw error;
      for (const name of names) {
        if (!(name in this.props))
          throw new Error(`mock: ${this.label} has no property ${name}`);
        this.values.set(name, this.props[name]());
      }
    }

    load(spec = "") {
      const names = spec
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      enqueue({
        call: `${this.label}.load`,
        cost: 0,
        comment: this.comment,
        run: () => this.fill(names),
      });
      return this;
    }
  }

  class Result<T> {
    private resolved = false;
    private stored: T | undefined;
    get value(): T {
      if (!this.resolved)
        throw officeError("ValueNotLoaded", "mock: value read before sync");
      return this.stored as T;
    }
    set(value: T) {
      this.stored = value;
      this.resolved = true;
    }
  }

  const result = <T>(
    call: string,
    compute: () => T,
    cost = 0,
    comment?: string,
  ) => {
    const out = new Result<T>();
    enqueue({ call, cost, comment, run: () => out.set(compute()) });
    return out;
  };

  class Collection<T extends Loadable> {
    private loaded: T[] | null = null;
    constructor(
      private readonly label: string,
      private readonly make: () => T[],
      private readonly extra?: Pick<Command, "cost" | "comment"> & {
        failure?: () => Error | null;
      },
    ) {}

    get items(): T[] {
      if (!this.loaded)
        throw officeError(
          "PropertyNotLoaded",
          `mock: ${this.label}.items is not loaded`,
        );
      return this.loaded;
    }

    load(spec = "") {
      const names = spec
        .split(",")
        .map((s) => s.trim().replace(/^items\/?/, ""))
        .filter(Boolean);
      enqueue({
        call: `${this.label}.load`,
        cost: this.extra?.cost ?? 0,
        comment: this.extra?.comment,
        run: () => {
          const error = this.extra?.failure?.();
          if (error) throw error;
          const items = this.make();
          for (const item of items) item.fill(names);
          this.loaded = items;
        },
      });
      return this;
    }
  }

  const packageOf = (tags: readonly string[]): string => {
    const known = document.v3c && tags.every((tag) => tag in V3C_PARAGRAPHS);
    if (!known)
      return plainPackage(tags.map((tag) => byTag.get(tag)!.laid.visible));
    if (tags.length > 1) {
      const cells = tags.map((tag) => byTag.get(tag)!.cell);
      const row = cells[0];
      return row &&
        cells.every((c) => c && c.table === row.table && c.row === row.row)
        ? v3cRowPackage(row.rowTags, packageOptions)
        : v3cRangePackage(tags, packageOptions);
    }
    const p = byTag.get(tags[0])!;
    return p.cell && !web
      ? v3cRowPackage(p.cell.rowTags, packageOptions)
      : v3cParagraphPackage(p.tag, packageOptions);
  };

  class MockTableCell extends Loadable {
    constructor(p: Para) {
      super(
        {
          isNullObject: () => p.cell === null,
          rowIndex: () => p.cell?.row,
          cellIndex: () => p.cell?.cell,
        },
        "tableCell",
      );
    }
    override load(spec = "") {
      return super.load(spec ? `isNullObject,${spec}` : "isNullObject");
    }
  }

  const levelOf = (style: string) => {
    const match = /^Heading([1-9])$/.exec(style);
    return match ? Number(match[1]) : 10;
  };

  class MockParagraph extends Loadable {
    constructor(private readonly p: Para) {
      super(
        {
          uniqueLocalId: () =>
            options.nullParagraphIds ? null : `{0000-${p.tag}}`,
          text: () => p.laid.rangeText,
          tableNestingLevel: () => (p.cell ? 1 : 0),
          outlineLevel: () => levelOf(p.style),
          styleBuiltIn: () => p.style,
        },
        "paragraph",
      );
    }
    get parentTableCellOrNullObject() {
      return new MockTableCell(this.p);
    }
    getText(options?: Parameters<Laid["shown"]>[0]) {
      return result("paragraph.getText", () => this.p.laid.shown(options));
    }
    getOoxml() {
      return result(
        "paragraph.getOoxml",
        () => packageOf([this.p.tag]),
        costs.ooxml,
      );
    }
    getRange(_location?: string) {
      callLog.push("paragraph.getRange");
      return new MockRange(
        {
          s: this.p.base,
          e: this.p.base + this.p.laid.rangeText.length + 1,
          first: this.p.index,
          last: this.p.index,
        },
        null,
      );
    }
  }

  class ParagraphCollection extends Collection<MockParagraph> {
    constructor(private readonly indices: readonly number[]) {
      super("paragraphs", () =>
        indices.map((i) => new MockParagraph(paragraphs[i])),
      );
    }
    getFirst() {
      return new MockParagraph(paragraphs[this.indices[0]]);
    }
    getLast() {
      return new MockParagraph(paragraphs[this.indices.at(-1)!]);
    }
  }

  const between = (first: number, last: number) =>
    Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const commentText = (key: string): string => {
    const span = anchors.get(key)!;
    if (span.s === span.e) return "";
    const first = paragraphs[span.first];
    const last = paragraphs[span.last];
    const from = span.s - first.base;
    const to = span.e - last.base;
    let text: string;
    if (span.first === span.last) text = first.laid.rangeText.slice(from, to);
    else {
      const parts = [
        first.laid.rangeText.slice(from),
        ...between(span.first + 1, span.last - 1).map(
          (i) => paragraphs[i].laid.rangeText,
        ),
        last.laid.rangeText.slice(0, to),
      ];
      text = parts[0];
      for (let i = 1; i < parts.length; i += 1) {
        const a = paragraphs[span.first + i - 1].cell;
        const b = paragraphs[span.first + i].cell;
        const sameRow = !!a && !!b && a.table === b.table && a.row === b.row;
        text += (sameRow && !web ? "\t" : "\r") + parts[i];
      }
    }
    return web && last.laid.rangeText[to] === "\u0005" ? `${text}\u0005` : text;
  };

  class MockRange extends Loadable {
    constructor(
      readonly span: Span,
      private readonly key: string | null,
    ) {
      super(
        {
          text: () =>
            key
              ? commentText(key)
              : between(span.first, span.last)
                  .map((i) => paragraphs[i].laid.rangeText)
                  .join("\r"),
          isEmpty: () => span.s === span.e,
        },
        "range",
        () =>
          key && options.failRanges?.includes(key)
            ? officeError("GeneralException", message)
            : null,
        key ?? undefined,
      );
    }
    get paragraphs() {
      return new ParagraphCollection(between(this.span.first, this.span.last));
    }
    compareLocationWith(other: MockRange) {
      return result(
        "range.compareLocationWith",
        () => relation(this.span, other.span),
        costs.compare,
      );
    }
    expandTo(other: MockRange) {
      callLog.push("range.expandTo");
      return new MockRange(
        {
          s: Math.min(this.span.s, other.span.s),
          e: Math.max(this.span.e, other.span.e),
          first: Math.min(this.span.first, other.span.first),
          last: Math.max(this.span.last, other.span.last),
        },
        null,
      );
    }
    getOoxml() {
      return result(
        "range.getOoxml",
        () =>
          packageOf(
            between(this.span.first, this.span.last).map(
              (i) => paragraphs[i].tag,
            ),
          ),
        costs.ooxml,
      );
    }
    getComments() {
      callLog.push("range.getComments");
      return new Collection<Loadable>("comments", () => []);
    }
    select(_mode?: string) {
      const span = { ...this.span };
      enqueue({
        call: "range.select",
        cost: 0,
        run: () => {
          selected = span;
        },
      });
    }
  }

  const entryProps = (key: string) => {
    const comment = document.comments[key];
    return {
      id: () => officeId(key),
      authorName: () => comment.author,
      authorEmail: () => emailOf(comment.author),
      creationDate: () => dateOf(comment),
      content: () => comment.content,
    };
  };

  class MockReply extends Loadable {
    constructor(key: string) {
      super(entryProps(key), "reply");
    }
  }

  class MockComment extends Loadable {
    constructor(private readonly key: string) {
      super(
        {
          ...entryProps(key),
          resolved: () => document.comments[key].done,
        },
        "comment",
      );
    }
    get replies() {
      const replies = repliesOf(this.key);
      return new Collection<MockReply>(
        "replies",
        () => replies.map((k) => new MockReply(k)),
        {
          cost: costs.reply * replies.length,
          comment: this.key,
          failure: () =>
            options.failReplies?.includes(this.key)
              ? officeError("GeneralException", message)
              : null,
        },
      );
    }
    getRange() {
      callLog.push("comment.getRange");
      rangeLog.push(this.key);
      const anchor = anchors.get(this.key)!;
      const first = paragraphs[anchor.first];
      if (web && first.laid.hidden) unhid.add(first.tag);
      return new MockRange(anchor, this.key);
    }
  }

  const context = {
    document: {
      body: {
        get paragraphs() {
          return new ParagraphCollection(paragraphs.map((p) => p.index));
        },
        getComments() {
          callLog.push("body.getComments");
          return new Collection<MockComment>(
            "comments",
            () => listed.map((key) => new MockComment(key)),
            {
              cost: 0,
              failure: () =>
                options.failList
                  ? officeError("GeneralException", message)
                  : null,
            },
          );
        },
      },
      getSelection() {
        callLog.push("document.getSelection");
        if (selected) return new MockRange(selected, null);
        const chosen = options.selection;
        if (!chosen) {
          const last = paragraphs.length - 1;
          return new MockRange(
            { s: 0, e: paragraphs[last].base, first: 0, last },
            null,
          );
        }
        const point = ({ tag, offset }: CommentHostPoint) => {
          const p = byTag.get(tag);
          if (!p) throw new Error(`mock: no paragraph ${tag}`);
          return { at: p.base + offset, index: p.index };
        };
        const from = point(chosen);
        const to = chosen.to ? point(chosen.to) : from;
        return new MockRange(
          { s: from.at, e: to.at, first: from.index, last: to.index },
          null,
        );
      },
    },
    sync,
  };

  const getFileAsync = vi.fn();
  const officeContext = Office.context as unknown as Record<string, unknown>;
  officeContext.document = { getFileAsync, url: "https://contoso.test/doc" };
  officeContext.requirements = { isSetSupported: () => true };
  officeContext.diagnostics = {
    host: "Word",
    platform: PLATFORM[flavour],
    version: "16.0.0.0",
  };
  (globalThis as Record<string, unknown>).Word = {
    run: async <T>(callback: (ctx: typeof context) => Promise<T>) =>
      callback(context),
  };
  teardown = () => {
    const ctx = Office.context as unknown as Record<string, unknown>;
    delete ctx.document;
    delete ctx.requirements;
    delete ctx.diagnostics;
    delete (globalThis as Record<string, unknown>).Word;
  };

  return {
    syncCount: () => syncs,
    syncLog: () => syncEntries.map((entry) => ({ ...entry })),
    calls: () => [...callLog],
    now: () => clock,
    listedIds: () => listed.map(officeId),
    rangesRead: () => [...rangeLog],
    unhidden: () => [...unhid],
    commentId: idOf,
    ordinalOf: (tag) => {
      const p = byTag.get(tag);
      if (!p) throw new Error(`mock: no paragraph ${tag}`);
      return p.index + 1;
    },
    selected: () => {
      if (!selected) return null;
      const first = paragraphs[selected.first];
      const last = paragraphs[selected.last];
      return {
        first: first.tag,
        last: last.tag,
        from: selected.s - first.base,
        to: selected.e - last.base,
      };
    },
    anchorOf: (key) => {
      const span = anchors.get(key);
      if (!span) throw new Error(`mock: no anchor ${key}`);
      const first = paragraphs[span.first];
      const last = paragraphs[span.last];
      return {
        first: first.tag,
        last: last.tag,
        from: span.s - first.base,
        to: span.e - last.base,
      };
    },
    getFileAsync,
  };
}

export function uninstallWordCommentHost(): void {
  teardown?.();
  teardown = undefined;
}
