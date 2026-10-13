import { resolveHeadingLevel } from "./buildWordDocumentArgs";
import {
  joinWordCommentSpansByContent,
  readWordCommentParagraphPackage,
  readWordCommentRangePackage,
  wordCommentAnchorText,
  wordCommentSourceBetween,
  wordCommentTextSpan,
  wordParagraphViewFromText,
} from "./wordCommentPackage";
import { wordHostPlatform } from "./wordHostPlatform";
import { wordParagraphId } from "./wordParagraphIds";
import { WORD_SELECTION_TEXT_OPTIONS } from "./wordReviewLocation";
import { withWordTimeout } from "./wordTimeout";
import { wordWriteHost } from "./wordWriteHost";

import type {
  WordCommentAnchorSource,
  WordCommentAnchorText,
  WordCommentJoin,
  WordCommentPackageRead,
  WordCommentPlacedSource,
  WordCommentSpan,
  WordParagraphTexts,
  WordParagraphView,
} from "./wordCommentPackage";
import type { WordHostPlatform } from "./wordHostPlatform";

/**
 * Word's comment threads as the pane reads them (ERMAIN-948). Office.js is the one record (O-2):
 * body.getComments(), each thread's replies and Comment.getRange(). Package OOXML only adds
 * in-paragraph offsets, joined by durableId (wordCommentPackage.ts), and only for the threads a
 * caller asks for, because the web takes about 0.7 s per thread for them (probe ERMAIN-947,
 * P-PERF). Document order comes from paragraph ordinals and compareLocationWith, never from
 * items order, which follows end marks on desktop and starts on the web (F-10). getFileAsync and
 * getSelection().getComments() are never used: the first is the v1 route, the second differs by
 * host at anchor edges (F-11).
 *
 * Word for the web unhides hidden text in front of an anchor once Comment.getRange(), or anything
 * on that range, runs, and the change is saved (ERMAIN-948 gate F1); paragraph.text, getText() and
 * getOoxml() change nothing. Every host but PC and Mac therefore places the threads of a paragraph
 * with hidden text from its package and never reads their ranges (guardHiddenText).
 */

/** Contract §12: at most this many threads per sync. */
export const WORD_COMMENT_SYNC_THREADS = 50;
/** Paragraph packages per sync in the exact phase; small, so a budget stops soon after it runs out. */
export const WORD_COMMENT_EXACT_BATCH = 4;
/** Longer multi-paragraph anchors are placed from their text, not from the range's package. */
export const WORD_COMMENT_RANGE_PARAGRAPHS_MAX = 40;
/** Packages without a dateUtc that make a desktop read call the file legacy. */
export const WORD_COMMENT_LEGACY_PACKAGES = 3;
/** compareLocationWith calls per sync when ordering threads that share a paragraph or lack one. */
export const WORD_COMMENT_ORDER_PAIRS_PER_SYNC = 1000;
export const WORD_COMMENT_ORDER_PAIRS_MAX = 5000;
/** Characters kept at each end of a multi-paragraph quote; the source keeps the whole text. */
export const WORD_COMMENT_QUOTE_EDGE_CHARS = 80;
export const WORD_COMMENT_READ_TIMEOUT_MS = 60_000;

export type WordCommentBudgetPhase = "anchors" | "replies" | "exact";
export type WordCommentReadPhase =
  | "list"
  | "inventory"
  | "selection"
  | "hidden"
  | WordCommentBudgetPhase
  | "order"
  | "relations"
  | "legacy";

export const WORD_COMMENT_READ_BUDGETS_MS: Readonly<
  Record<WordCommentBudgetPhase, number>
> = { anchors: 15_000, replies: 15_000, exact: 10_000 };

const COMMENT_FIELDS =
  "items/id,items/resolved,items/authorName,items/authorEmail,items/creationDate,items/content";
const REPLY_FIELDS =
  "items/id,items/authorName,items/authorEmail,items/creationDate,items/content";
const PARAGRAPH_FIELDS = "uniqueLocalId,text,tableNestingLevel";

/** The review facet's paragraphs, which give anchors their ordinals. */
export interface WordCommentInventoryParagraph {
  /** 1-based and dense, as body.paragraphs lists them, cells included. */
  ordinal: number;
  id: string | null;
  /** getText(), as the capture records it; a light read keeps it for headings, or for all without ids. */
  text?: string;
  heading?: number | null;
  /** Paragraph.tableNestingLevel. */
  nesting?: number;
}

export interface WordCommentInventory {
  source: "capture" | "light";
  paragraphs: readonly WordCommentInventoryParagraph[];
}

/** The Send capture's ordinal map, when the document was read for this message. */
export function wordCommentInventoryFromCapture(
  ordinalMap: ReadonlyMap<
    number,
    { uniqueLocalId: string | null; text: string }
  >,
): WordCommentInventory {
  return {
    source: "capture",
    paragraphs: [...ordinalMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([ordinal, p]) => ({
        ordinal,
        id: p.uniqueLocalId || null,
        text: p.text,
      })),
  };
}

/** A thread's comment or one of its replies, as Office.js lists it. */
export interface WordCommentEntryRecord {
  /** String(id): the decimal durableId, which the web returns as a number (F-2). */
  id: string;
  authorName: string;
  /** Kept in the pane to derive `me`; never sent, logged or reported. */
  authorEmail: string | null;
  /** Minute precision on desktop; null on the web when the file has no dateUtc (F-4). */
  creationDate: Date | null;
  content: string;
}

export interface WordCommentParagraphRef {
  /** The review ordinal; null when the inventory could not place the paragraph. */
  ordinal: number | null;
  via: "id" | "text" | null;
  /** paragraph.text when the anchor was read. */
  rangeText: string;
  nesting: number;
  /** The innermost cell, 0-based; null outside tables. */
  cell: { row: number; cell: number } | null;
  /** 1-based number of the top-level table the paragraph is in; null outside one or when unknown. */
  table: number | null;
}

/** Where a thread is anchored, from Comment.getRange() without any package read. */
export interface WordCommentCoarseAnchor {
  /** Comment.getRange().text: U+0005 on the web, cells joined by "\t" or "\r" (F-7, F-12). */
  rangeText: string;
  first: WordCommentParagraphRef;
  last: WordCommentParagraphRef;
  /** First and last are the same paragraph. */
  single: boolean;
}

export interface WordCommentEdgeOffsets {
  /** In paragraph.text of the edge's paragraph. */
  range: number;
  /** In that paragraph's visible text. */
  visible: number;
}

export interface WordCommentOffsets {
  /** In the first paragraph. */
  start: WordCommentEdgeOffsets;
  /** In the last paragraph. */
  end: WordCommentEdgeOffsets;
}

export type WordCommentPlacement =
  | {
      status: "placed";
      /** "content" is the legacy fallback (O-17); it feeds counts.matchedByContent. */
      joinedBy: WordCommentJoin | "text";
      anchor: WordCommentAnchorText;
      /** For a different quote length: wordCommentAnchorText(source, { edgeChars }). */
      source: WordCommentAnchorSource;
      offsets: WordCommentOffsets;
    }
  | {
      /** unplaced: read, but not found in the text; budget: not read in time; failed: not read. */
      status: "unplaced" | "budget" | "failed";
      anchor: WordCommentAnchorText;
      source: Extract<WordCommentAnchorSource, { kind: "unplaced" }>;
    };

export type WordCommentReadOnly =
  /** The reply list could not be loaded. */
  | "replies-failed"
  /** The web listed the root, or a reply twice, among the replies (F-1). */
  | "replies-repeated"
  /** Word listed the same id twice, so no write could tell the two apart (contract §4.6). */
  | "id-repeated";

export interface WordCommentThreadRecord extends WordCommentEntryRecord {
  resolved: boolean;
  /** In Word's order; null when not read (budget, or not asked for). */
  replies: WordCommentEntryRecord[] | null;
  readOnly: WordCommentReadOnly | null;
  /** Null when the anchor could not be read. */
  anchor: WordCommentCoarseAnchor | null;
  /** 0-based rank in document order. */
  order: number;
  /** For the threads the exact request named, and those placed from a package for hidden text. */
  placement?: WordCommentPlacement;
  /**
   * The anchor's compareLocationWith the user's selection, as Word names the relation; only for
   * anchors around it, when the read was asked to relate them.
   */
  selection?: string;
}

/** Where the user's selection or caret was when the comments were read. */
export interface WordCommentLiveSelection {
  collapsed: boolean;
  /** Review ordinals of its first and last paragraph; null outside the inventory, as in a header. */
  first: number | null;
  last: number | null;
}

export interface WordCommentPhaseTiming {
  phase: WordCommentReadPhase;
  ms: number;
  syncs: number;
  /** What the phase had to cover, and what it did: threads, pairs or paragraphs. */
  total: number;
  done: number;
  budgetMs?: number;
  exhausted?: true;
}

export interface WordCommentReadCounts {
  repliesFailed: number;
  repliesRepeated: number;
  idsRepeated: number;
  anchorsFailed: number;
  anchorsSkipped: number;
  /** Paragraphs with comments and hidden text, whose threads were placed from their packages. */
  hiddenParagraphs: number;
  /** Threads whose ranges were not read, because a paragraph with hidden text was not explained. */
  anchorsWithheld: number;
  paragraphsByText: number;
  positionUnknown: number;
  placed: number;
  matchedByContent: number;
  unplaced: number;
  budget: number;
  failed: number;
}

export interface WordCommentReadError {
  phase: WordCommentReadPhase;
  /** The error's name, never its message, which can quote the document. */
  error: string;
  officeCode?: string;
}

/** Counts, timings and error names only: no comment text, author, email or document text. */
export interface WordCommentReadDiagnostics {
  host: WordHostPlatform;
  inventory: WordCommentInventory["source"] | null;
  threads: number;
  replies: number;
  legacy: boolean | null;
  totalMs: number;
  phases: WordCommentPhaseTiming[];
  counts: WordCommentReadCounts;
  errors: WordCommentReadError[];
}

export type WordCommentReadResult =
  | {
      ok: true;
      /** In document order. */
      threads: WordCommentThreadRecord[];
      /** Null when there was nothing to place. */
      inventory: WordCommentInventory | null;
      /**
       * Ids hold for this pane session only (F-2a, O-17), as no comment has a dateUtc (see
       * wordCommentLegacy). Null: unknown.
       */
      legacy: boolean | null;
      dateUtc: WordCommentDateUtc;
      /** Null unless the read was asked to relate anchors to the selection, or it could not. */
      selection: WordCommentLiveSelection | null;
      diagnostics: WordCommentReadDiagnostics;
    }
  | { ok: false; error: string; diagnostics: WordCommentReadDiagnostics };

/**
 * Whether creationDate came from dateUtc, as the packages read show it (F-4): without one, desktop
 * reads w:date in the host's zone. Only the comments of the paragraphs read are known.
 */
export interface WordCommentDateUtc {
  /** By String(Comment.id) of comments and replies. */
  byId: ReadonlyMap<string, boolean>;
  /**
   * For the comments no package showed: false in a legacy file, which has no dateUtc at all, and
   * otherwise null. A sample of packages never vouches for the rest, so they are never taken as UTC.
   */
  otherwise: boolean | null;
}

/** What one read placed, kept for the next read of the same document. */
export interface WordCommentAnchorSnapshot {
  generation: number;
  /** String(Comment.id), in the order Word listed the comments. */
  ids: readonly string[];
  inventory: WordCommentInventory;
  /** In the same order as `ids`. */
  threads: readonly {
    anchor: WordCommentCoarseAnchor | null;
    order: number;
    placement?: WordCommentPlacement;
    /** Its range was read, so reading it again is no new read (gate F1). */
    ranged: boolean;
  }[];
  dateUtc: WordCommentDateUtc;
}

/**
 * Anchors kept between reads of one document. Its owner bumps `generation` whenever the body may
 * have changed; a snapshot of another generation, or of other comments, is never reused.
 */
export interface WordCommentAnchorCache {
  generation: number;
  snapshot: WordCommentAnchorSnapshot | null;
}

export interface WordCommentReadOptions {
  /** The Send capture's paragraphs; without them a light read of the body supplies the ordinals. */
  inventory?: WordCommentInventory;
  /**
   * The threads to place exactly, most important first: selection threads, then picked or section
   * threads. Called once with every thread in document order, before replies are read.
   */
  exact?: (
    threads: readonly WordCommentThreadRecord[],
    selection: WordCommentLiveSelection | null,
  ) => readonly string[];
  /**
   * Also read where the user's selection or caret is, and relate the anchors around it with
   * compareLocationWith: a caret has no offset for coordinates to place it by.
   */
  selection?: boolean;
  /** "requested" reads replies only for the threads `exact` names (Word for Mac lists them slowly). */
  replies?: "all" | "requested";
  /**
   * False reads no package for exact anchors (about 0.7 s each on the web): `exact` then only names
   * the threads whose replies to list. Paragraphs with hidden text off desktop, and on desktop the
   * packages that tell `legacy` while it is unknown, are read all the same.
   */
  packages?: boolean;
  /**
   * What an earlier read of this document found in this pane session; the read then asks no package
   * for it, so refs keep the source they started with.
   */
  legacy?: boolean | null;
  budgetsMs?: Partial<Record<WordCommentBudgetPhase, number>>;
  onProgress?: (
    done: number,
    total: number,
    phase: WordCommentBudgetPhase,
  ) => void;
  /** A millisecond clock for the budgets and timings. */
  now?: () => number;
  /**
   * Keeps a read's anchors for the next one. With `reuse`, while Word lists the same comments in
   * the same generation, the read takes the kept anchors and reads only the selection, the ranges
   * reaching its paragraphs and the replies: no body, no anchor and no order. Only for reads with
   * `packages: false` and a known `legacy`.
   */
  anchors?: { cache: WordCommentAnchorCache; reuse: boolean };
}

interface Live {
  record: WordCommentThreadRecord;
  comment: Word.Comment;
  range?: Word.Range;
  first?: Word.Paragraph;
  last?: Word.Paragraph;
}

type Step = () => Step | null;

class WordCommentReadTimeout extends Error {
  constructor() {
    super("The comment read timed out");
    this.name = "WordCommentReadTimeout";
  }
}

const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,60}$/;
const OFFICE_CODE = /^[A-Za-z][A-Za-z0-9.]{0,79}$/;
const MAX_ERRORS = 20;

function errorOf(
  phase: WordCommentReadPhase,
  error: unknown,
): WordCommentReadError {
  const name = error instanceof Error ? error.name : typeof error;
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return {
    phase,
    error: ERROR_NAME.test(name) ? name : "Error",
    ...(typeof code === "string" && OFFICE_CODE.test(code)
      ? { officeCode: code }
      : {}),
  };
}

const describeError = ({ phase, error, officeCode }: WordCommentReadError) =>
  `${phase}: ${error}${officeCode ? ` (${officeCode})` : ""}`;

class Session {
  readonly diagnostics: WordCommentReadDiagnostics = {
    host: "unknown",
    inventory: null,
    threads: 0,
    replies: 0,
    legacy: null,
    totalMs: 0,
    phases: [],
    counts: {
      repliesFailed: 0,
      repliesRepeated: 0,
      idsRepeated: 0,
      anchorsFailed: 0,
      anchorsSkipped: 0,
      hiddenParagraphs: 0,
      anchorsWithheld: 0,
      paragraphsByText: 0,
      positionUnknown: 0,
      placed: 0,
      matchedByContent: 0,
      unplaced: 0,
      budget: 0,
      failed: 0,
    },
    errors: [],
  };
  phase: WordCommentReadPhase = "list";
  abandoned = false;
  private timing: WordCommentPhaseTiming | null = null;
  private started = 0;
  private context: Word.RequestContext | null = null;

  constructor(
    private readonly now: () => number,
    private readonly onProgress: WordCommentReadOptions["onProgress"],
  ) {}

  attach(context: Word.RequestContext) {
    this.context = context;
  }

  begin(phase: WordCommentReadPhase, total: number, budgetMs?: number) {
    this.phase = phase;
    this.started = this.now();
    this.timing = {
      phase,
      ms: 0,
      syncs: 0,
      total,
      done: 0,
      ...(budgetMs === undefined ? {} : { budgetMs }),
    };
    this.diagnostics.phases.push(this.timing);
  }

  async sync() {
    if (this.abandoned || !this.context) throw new WordCommentReadTimeout();
    if (this.timing) this.timing.syncs += 1;
    await this.context.sync();
  }

  /** The phase's budget is used up; checked before each batch, so a batch never stops halfway. */
  spent(): boolean {
    const timing = this.timing;
    if (!timing || timing.budgetMs === undefined) return false;
    if (this.now() - this.started < timing.budgetMs) return false;
    timing.exhausted = true;
    return true;
  }

  /** For a phase that learns what it covers only after its first sync. */
  cover(total: number) {
    if (this.timing) this.timing.total = total;
  }

  advance(done: number) {
    const timing = this.timing;
    if (!timing) return;
    timing.done = done;
    // Only the anchors, replies and exact phases advance.
    this.onProgress?.(
      done,
      timing.total,
      timing.phase as WordCommentBudgetPhase,
    );
  }

  end(done?: number) {
    const timing = this.timing;
    if (!timing) return;
    if (done !== undefined) timing.done = done;
    timing.ms = Math.round(this.now() - this.started);
    this.timing = null;
  }

  note(error: unknown) {
    if (this.diagnostics.errors.length < MAX_ERRORS)
      this.diagnostics.errors.push(errorOf(this.phase, error));
  }
}

/**
 * Reads every comment thread of the main body in one Word.run: list, coarse anchors and document
 * order for all of them, replies for all or the requested ones, and exact anchors for the
 * requested ones. Each phase stops at its budget and says so; nothing in the result is guessed.
 */
export async function readWordComments(
  options: WordCommentReadOptions = {},
): Promise<WordCommentReadResult> {
  const now = options.now ?? Date.now;
  const session = new Session(now, options.onProgress);
  const { diagnostics } = session;
  diagnostics.host = wordHostPlatform();
  const word = wordWriteHost();
  if (!word)
    return { ok: false, error: "list: Word is not available", diagnostics };
  const started = now();
  try {
    const result = await withWordTimeout(
      word.run((context) => {
        session.attach(context);
        return readThreads(context, session, options);
      }),
      WORD_COMMENT_READ_TIMEOUT_MS,
      () => new WordCommentReadTimeout(),
    );
    diagnostics.totalMs = Math.round(now() - started);
    return result;
  } catch (error) {
    session.abandoned = true;
    const entry = errorOf(session.phase, error);
    if (diagnostics.errors.length < MAX_ERRORS) diagnostics.errors.push(entry);
    diagnostics.totalMs = Math.round(now() - started);
    return { ok: false, error: describeError(entry), diagnostics };
  }
}

function dateOf(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  return date && value !== "" && !Number.isNaN(date.getTime()) ? date : null;
}

const textOf = (value: unknown) => (typeof value === "string" ? value : "");

function entryOf(item: {
  id: unknown;
  authorName: unknown;
  authorEmail: unknown;
  creationDate: unknown;
  content: unknown;
}): WordCommentEntryRecord {
  return {
    id: String(item.id),
    authorName: textOf(item.authorName),
    authorEmail: textOf(item.authorEmail) || null,
    creationDate: dateOf(item.creationDate),
    content: textOf(item.content),
  };
}

async function readThreads(
  context: Word.RequestContext,
  session: Session,
  options: WordCommentReadOptions,
): Promise<WordCommentReadResult> {
  const { diagnostics } = session;
  const budgets = { ...WORD_COMMENT_READ_BUDGETS_MS, ...options.budgetsMs };

  session.begin("list", 1);
  const collection = context.document.body.getComments();
  collection.load(COMMENT_FIELDS);
  await session.sync();
  const live: Live[] = collection.items.map((comment) => ({
    comment,
    record: {
      ...entryOf(comment),
      resolved: comment.resolved === true,
      replies: null,
      readOnly: null,
      anchor: null,
      order: 0,
    },
  }));
  session.end(1);
  markRepeatedIds(live, session);
  diagnostics.threads = live.length;
  const anchors = options.packages === false ? options.anchors : undefined;
  const generation = anchors?.cache.generation ?? 0;
  const ids = live.map(({ record }) => record.id);
  if (live.length === 0)
    return resultOf(diagnostics, [], {
      inventory: options.inventory ?? null,
      legacy: null,
      dateUtc: new PackageNotes().dateUtc(),
      selection: null,
    });

  const kept =
    anchors?.reuse && options.legacy != null && !options.inventory
      ? keptAnchors(anchors.cache, ids)
      : null;
  if (kept) return readFromKept(context, session, options, live, kept);

  const inventory =
    options.inventory ?? (await readLightInventory(context, session));
  diagnostics.inventory = inventory.source;
  const selection = options.selection
    ? await readLiveSelection(context, session, inventory)
    : null;
  // Only PC and Mac are known to read comment ranges without changing the document.
  const desktop = diagnostics.host === "PC" || diagnostics.host === "Mac";
  const notes = new PackageNotes();
  const hidden = desktop
    ? null
    : await guardHiddenText(
        context,
        session,
        live,
        inventory,
        budgets.anchors,
        notes,
      );
  await readAnchors(context, session, live, inventory, budgets.anchors, hidden);
  const sorted = await orderThreads(session, live);
  if (selection) await relateSelection(session, sorted, selection);
  const records = sorted.map((thread) => thread.record);

  const asked = await readAskedReplies(
    session,
    options,
    sorted,
    records,
    selection?.info ?? null,
  );
  if (options.packages !== false)
    await placeExact(session, sorted, asked, budgets.exact, notes, desktop);
  let legacy = options.legacy ?? null;
  if (legacy === null) {
    if (!desktop) legacy = undatedFile(records);
    else {
      if (notes.undecided()) await probeLegacy(session, sorted, notes);
      legacy = notes.legacy();
    }
  }

  const dateUtc = notes.dateUtc();
  if (
    anchors &&
    anchors.cache.generation === generation &&
    placedWhole(diagnostics)
  )
    anchors.cache.snapshot = {
      generation,
      ids,
      inventory,
      threads: live.map(({ record, range }) => ({
        anchor: record.anchor,
        order: record.order,
        ...(record.placement ? { placement: record.placement } : {}),
        ranged: !!range,
      })),
      dateUtc,
    };
  return resultOf(diagnostics, records, {
    inventory,
    legacy,
    dateUtc,
    selection: selection?.info ?? null,
  });
}

/** Replies for every thread, or only for those `exact` names; returns the threads it names. */
async function readAskedReplies(
  session: Session,
  options: WordCommentReadOptions,
  sorted: readonly Live[],
  records: readonly WordCommentThreadRecord[],
  selection: WordCommentLiveSelection | null,
): Promise<Live[]> {
  const budgets = { ...WORD_COMMENT_READ_BUDGETS_MS, ...options.budgetsMs };
  const asked = requested(options.exact?.(records, selection) ?? [], sorted);
  await readReplies(
    session,
    options.replies === "requested" ? asked : sorted,
    budgets.replies,
  );
  return asked;
}

function resultOf(
  diagnostics: WordCommentReadDiagnostics,
  records: WordCommentThreadRecord[],
  read: Pick<
    Extract<WordCommentReadResult, { ok: true }>,
    "inventory" | "legacy" | "dateUtc" | "selection"
  >,
): WordCommentReadResult {
  diagnostics.legacy = read.legacy;
  diagnostics.replies = records.reduce(
    (sum, record) => sum + (record.replies?.length ?? 0),
    0,
  );
  countOutcomes(diagnostics.counts, records);
  return {
    ok: true,
    threads: records,
    inventory: read.inventory,
    legacy: read.legacy,
    dateUtc: read.dateUtc,
    selection: read.selection,
    diagnostics,
  };
}

/** Every anchor was read or withheld for hidden text, and the order was decided, without an error. */
function placedWhole(diagnostics: WordCommentReadDiagnostics): boolean {
  return (
    diagnostics.errors.every((e) => e.phase === "replies") &&
    diagnostics.counts.anchorsSkipped === 0 &&
    diagnostics.phases.every(
      (p) =>
        !p.exhausted &&
        (p.phase !== "order" || p.done === p.total) &&
        (p.phase !== "hidden" || p.done === p.total),
    )
  );
}

function keptAnchors(
  cache: WordCommentAnchorCache,
  ids: readonly string[],
): WordCommentAnchorSnapshot | null {
  const kept = cache.snapshot;
  return kept &&
    kept.generation === cache.generation &&
    kept.ids.length === ids.length &&
    kept.ids.every((id, i) => id === ids[i])
    ? kept
    : null;
}

/** The anchor reaches the selection's paragraphs, or its paragraph is unknown. */
function reaches(
  record: WordCommentThreadRecord,
  first: number,
  last: number,
): boolean {
  const from = record.anchor?.first.ordinal ?? null;
  const to = record.anchor?.last.ordinal ?? from;
  return from === null || to === null || (from <= last && to >= first);
}

/**
 * A read over kept anchors: the comments as Word lists them now, placed where the kept read placed
 * them, related to the live selection through the ranges of the anchors reaching its paragraphs.
 */
async function readFromKept(
  context: Word.RequestContext,
  session: Session,
  options: WordCommentReadOptions,
  live: readonly Live[],
  kept: WordCommentAnchorSnapshot,
): Promise<WordCommentReadResult> {
  const { diagnostics } = session;
  const { inventory } = kept;
  diagnostics.inventory = inventory.source;
  live.forEach(({ record }, i) => {
    const thread = kept.threads[i];
    record.anchor = thread.anchor;
    record.order = thread.order;
    if (thread.placement) record.placement = thread.placement;
  });
  const sorted = [...live].sort((a, b) => a.record.order - b.record.order);
  const selection = options.selection
    ? await readLiveSelection(context, session, inventory)
    : null;
  const { first, last } = selection?.info ?? { first: null, last: null };
  if (selection && first !== null && last !== null) {
    // Only ranges the kept read already read: a new one could unhide text on the web (gate F1).
    const around = live.filter(
      ({ record }, i) => kept.threads[i].ranged && reaches(record, first, last),
    );
    session.begin("anchors", around.length);
    const ranges = around.map(({ comment }) => comment.getRange());
    try {
      if (around.length > 0) await session.sync();
      around.forEach((thread, i) => {
        thread.range = ranges[i];
      });
      session.end(around.length);
    } catch (error) {
      session.note(error);
      session.end(0);
    }
    await relateSelection(session, sorted, selection);
  }
  const records = sorted.map((thread) => thread.record);
  await readAskedReplies(
    session,
    options,
    sorted,
    records,
    selection?.info ?? null,
  );
  return resultOf(diagnostics, records, {
    inventory,
    legacy: options.legacy ?? null,
    dateUtc: kept.dateUtc,
    selection: selection?.info ?? null,
  });
}

/**
 * A file without commentsIds has no stable ids (F-2a), yet every host's paragraph package carries
 * commentsIds (gate F2), so their absence never shows: the session's ids on desktop, ids other than
 * Comment.id on the web. A file without commentsIds has no commentsExtensible either, as dateUtc
 * is keyed by durableId, and Word invents no dateUtc: a file without any is taken as legacy. A
 * modern file whose comments all lack one, as older Word versions write them, is taken as legacy
 * too, and its threads are named by content.
 */
function wordCommentLegacy(dated: {
  withUtc: number;
  withoutUtc: number;
}): boolean | null {
  if (dated.withUtc > 0) return false;
  return dated.withoutUtc > 0 ? true : null;
}

/** The web gives creationDate only from dateUtc (F-4), so its dates answer for every thread read. */
function undatedFile(
  records: readonly WordCommentThreadRecord[],
): boolean | null {
  const entries = records.flatMap((record) => [
    record,
    ...(record.replies ?? []),
  ]);
  return wordCommentLegacy({
    withUtc: entries.filter((entry) => entry.creationDate !== null).length,
    withoutUtc: entries.filter((entry) => entry.creationDate === null).length,
  });
}

interface LiveSelection {
  range: Word.Range;
  info: WordCommentLiveSelection;
}

/** The selection's paragraphs by id; one in another story, such as a header, has no ordinal. */
async function readLiveSelection(
  context: Word.RequestContext,
  session: Session,
  inventory: WordCommentInventory,
): Promise<LiveSelection | null> {
  session.begin("selection", 1);
  try {
    const range = context.document.getSelection();
    range.load("isEmpty");
    const first = range.paragraphs.getFirst();
    const last = range.paragraphs.getLast();
    first.load("uniqueLocalId");
    last.load("uniqueLocalId");
    await session.sync();
    const byId = idIndex(inventory);
    const ordinalOf = (paragraph: Word.Paragraph) => {
      const id = wordParagraphId(paragraph.uniqueLocalId);
      return (id ? byId.get(id) : undefined) ?? null;
    };
    session.end(1);
    return {
      range,
      info: {
        collapsed: range.isEmpty,
        first: ordinalOf(first),
        last: ordinalOf(last),
      },
    };
  } catch (error) {
    session.note(error);
    session.end(0);
    return null;
  }
}

/** Relations only for anchors that reach the selection's paragraphs; paragraphs decide the rest. */
async function relateSelection(
  session: Session,
  sorted: readonly Live[],
  selection: LiveSelection,
) {
  const { first, last } = selection.info;
  if (first === null || last === null) return;
  const around = sorted.filter(
    ({ range, record }) => !!range && reaches(record, first, last),
  );
  session.begin("relations", around.length);
  let done = 0;
  for (const batch of chunks(around, WORD_COMMENT_SYNC_THREADS)) {
    const results = batch.map((thread) =>
      thread.range!.compareLocationWith(selection.range),
    );
    try {
      await session.sync();
      batch.forEach((thread, i) => {
        thread.record.selection = String(results[i].value);
      });
      done += batch.length;
    } catch (error) {
      session.note(error);
    }
  }
  session.end(done);
}

function markRepeatedIds(live: readonly Live[], session: Session) {
  const counts = new Map<string, number>();
  for (const { record } of live)
    counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  for (const { record } of live)
    if ((counts.get(record.id) ?? 0) > 1) {
      record.readOnly = "id-repeated";
      session.diagnostics.counts.idsRepeated += 1;
    }
}

function requested(ids: readonly string[], sorted: readonly Live[]): Live[] {
  const byId = new Map<string, Live>();
  for (const thread of sorted)
    if (!byId.has(thread.record.id)) byId.set(thread.record.id, thread);
  const out: Live[] = [];
  for (const id of new Set(ids)) {
    const thread = byId.get(id);
    if (thread) out.push(thread);
  }
  return out;
}

function countOutcomes(
  counts: WordCommentReadCounts,
  records: readonly WordCommentThreadRecord[],
) {
  for (const record of records) {
    if (record.anchor) {
      for (const edge of [record.anchor.first, record.anchor.last])
        if (edge.via === "text") counts.paragraphsByText += 1;
      if (record.anchor.first.ordinal === null) counts.positionUnknown += 1;
    }
    const placement = record.placement;
    if (!placement) continue;
    if (placement.status === "placed") {
      counts.placed += 1;
      if (placement.joinedBy === "content") counts.matchedByContent += 1;
    } else counts[placement.status] += 1;
  }
}

/** Ids, heading levels and nesting for every paragraph; texts only for headings, or for all without ids. */
async function readLightInventory(
  context: Word.RequestContext,
  session: Session,
): Promise<WordCommentInventory> {
  session.begin("inventory", 0);
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load(
    "items/uniqueLocalId,items/outlineLevel,items/styleBuiltIn,items/tableNestingLevel",
  );
  await session.sync();
  const items = paragraphs.items;
  const ids = items.map((p) => wordParagraphId(p.uniqueLocalId));
  const headings = items.map((p) =>
    resolveHeadingLevel({
      styleBuiltIn: String(p.styleBuiltIn ?? ""),
      outlineLevel: p.outlineLevel,
    }),
  );
  const everyText = ids.some((id) => id === null);
  const texts = items.map((p, i) =>
    everyText || headings[i] !== null ? p.getText() : null,
  );
  if (texts.some((text) => text !== null)) await session.sync();
  session.end(items.length);
  return {
    source: "light",
    paragraphs: items.map((p, i) => ({
      ordinal: i + 1,
      id: ids[i],
      ...(texts[i] ? { text: texts[i].value } : {}),
      heading: headings[i],
      nesting: p.tableNestingLevel,
    })),
  };
}

interface RawParagraph {
  id: string | null;
  rangeText: string;
  nesting: number;
  cell: { row: number; cell: number } | null;
}

interface RawAnchor {
  rangeText: string;
  first: RawParagraph;
  last: RawParagraph;
}

function queueParagraph(paragraph: Word.Paragraph): () => RawParagraph {
  paragraph.load(PARAGRAPH_FIELDS);
  const cell = paragraph.parentTableCellOrNullObject;
  cell.load("rowIndex,cellIndex");
  return () => ({
    id: wordParagraphId(paragraph.uniqueLocalId),
    rangeText: paragraph.text,
    nesting: paragraph.tableNestingLevel,
    cell: cell.isNullObject
      ? null
      : { row: cell.rowIndex, cell: cell.cellIndex },
  });
}

function queueAnchor(thread: Live): () => RawAnchor {
  const range = thread.comment.getRange();
  range.load("text");
  const first = range.paragraphs.getFirst();
  const last = range.paragraphs.getLast();
  const firstRead = queueParagraph(first);
  const lastRead = queueParagraph(last);
  return () => {
    thread.range = range;
    thread.first = first;
    thread.last = last;
    return { rangeText: range.text, first: firstRead(), last: lastRead() };
  };
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/** Ids that occur once; an id Word handed to a split-off paragraph (#5784) names neither. */
function idIndex(inventory: WordCommentInventory): Map<string, number> {
  const index = new Map<string, number>();
  const repeated = new Set<string>();
  for (const p of inventory.paragraphs) {
    if (!p.id) continue;
    if (index.has(p.id)) repeated.add(p.id);
    index.set(p.id, p.ordinal);
  }
  for (const id of repeated) index.delete(id);
  return index;
}

/**
 * The 1-based number of the top-level table each paragraph is in, by ordinal - 1. Word keeps a
 * paragraph between two top-level tables, so each run of cell paragraphs is one table.
 */
function tableNumbers(nesting: readonly number[]): (number | null)[] {
  let count = 0;
  return nesting.map((level, i) => {
    if (level <= 0) return null;
    if (i === 0 || nesting[i - 1] <= 0) count += 1;
    return level === 1 ? count : null;
  });
}

const REFERENCE_MARK = "\u0005";
const TEXT_MARKS = /[\u0002\u0005]/g;
/** What paragraph.text spells without its marks on the web, unless the paragraph has hidden text. */
const SHOWN_TEXT_OPTIONS = {
  IncludeHiddenText: false,
  IncludeTextMarkedAsDeleted: true,
} as const;

interface HiddenGuard {
  /** Threads anchored in a paragraph with hidden text, placed from its package. */
  anchors: Map<Live, RawAnchor>;
  /** Those paragraphs' ordinals where no paragraph id gives one. */
  ordinals: Map<RawParagraph, number>;
  /** A paragraph with hidden text was not fully explained, so no thread's range is read. */
  withhold: boolean;
}

interface HiddenRead {
  index: number;
  paragraph: Word.Paragraph;
  /** Only for a paragraph in a table: nothing but text and the package is asked of the rest. */
  cell: Word.TableCell | null;
  identity: ReturnType<Word.Paragraph["getText"]>;
  ooxml: ReturnType<Word.Paragraph["getOoxml"]>;
}

/**
 * Whether Show in Word may read this comment's range (gate F1): always on PC and Mac; elsewhere
 * only when no paragraph with hidden text marks it and every such paragraph is explained.
 * `comments` are body.getComments() with their ids loaded.
 */
export async function wordCommentRangeReadable(
  context: Word.RequestContext,
  comments: readonly Word.Comment[],
  commentId: string,
): Promise<boolean> {
  const host = wordHostPlatform();
  if (host === "PC" || host === "Mac") return true;
  const session = new Session(Date.now, undefined);
  session.attach(context);
  const live: Live[] = comments.map((comment) => ({
    comment,
    record: {
      ...entryOf({
        id: comment.id,
        authorName: "",
        authorEmail: null,
        creationDate: null,
        content: "",
      }),
      resolved: false,
      replies: null,
      readOnly: null,
      anchor: null,
      order: 0,
    },
  }));
  const guard = await guardHiddenText(
    context,
    session,
    live,
    { source: "capture", paragraphs: [] },
    WORD_COMMENT_READ_BUDGETS_MS.anchors,
    new PackageNotes(),
  );
  return (
    !guard.withhold &&
    ![...guard.anchors.keys()].some(({ record }) => record.id === commentId)
  );
}

/**
 * Off desktop (gate F1), a paragraph with a reference (U+0005, F-7) whose paragraph.text holds text
 * getText() leaves out is read from its own package, and the threads marked there are placed from
 * it by durableId with no range read. When a package does not explain every reference in its
 * paragraph, or names a thread the list does not hold once, no thread's range is read at all. A
 * thread that only starts in such a paragraph has no marks there (F-13) and is not caught.
 */
async function guardHiddenText(
  context: Word.RequestContext,
  session: Session,
  live: readonly Live[],
  inventory: WordCommentInventory,
  budgetMs: number,
  notes: PackageNotes,
): Promise<HiddenGuard> {
  const guard: HiddenGuard = {
    anchors: new Map(),
    ordinals: new Map(),
    withhold: false,
  };
  session.begin("hidden", 0, budgetMs);
  let done = 0;
  try {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items/uniqueLocalId,items/text,items/tableNestingLevel");
    await session.sync();
    const items = paragraphs.items;
    const marked = items.flatMap((p, i) =>
      p.text.includes(REFERENCE_MARK) ? [i] : [],
    );
    if (marked.length === 0) {
      session.end(0);
      return guard;
    }
    const shown = marked.map((i) => items[i].getText(SHOWN_TEXT_OPTIONS));
    await session.sync();
    const hidden = marked.filter(
      (i, k) => items[i].text.replace(TEXT_MARKS, "") !== shown[k].value,
    );
    session.cover(hidden.length);
    session.diagnostics.counts.hiddenParagraphs = hidden.length;
    const byId = new Map<string, Live[]>();
    for (const thread of live)
      byId.set(thread.record.id, [
        ...(byId.get(thread.record.id) ?? []),
        thread,
      ]);
    const positional =
      inventory.source === "light" &&
      inventory.paragraphs.length === items.length;
    for (const batch of chunks(hidden, WORD_COMMENT_EXACT_BATCH)) {
      if (session.spent()) {
        guard.withhold = true;
        break;
      }
      const reads = batch.map((index): HiddenRead => {
        const paragraph = items[index];
        const cell =
          paragraph.tableNestingLevel > 0
            ? paragraph.parentTableCellOrNullObject
            : null;
        cell?.load("rowIndex,cellIndex");
        return {
          index,
          paragraph,
          cell,
          identity: paragraph.getText(WORD_SELECTION_TEXT_OPTIONS),
          ooxml: paragraph.getOoxml(),
        };
      });
      await session.sync();
      for (const read of reads) {
        const { paragraph, cell } = read;
        const edge: RawParagraph = {
          id: wordParagraphId(paragraph.uniqueLocalId),
          rangeText: paragraph.text,
          nesting: paragraph.tableNestingLevel,
          cell:
            !cell || cell.isNullObject
              ? null
              : { row: cell.rowIndex, cell: cell.cellIndex },
        };
        // The light inventory lists the same body paragraphs in this run.
        if (positional) guard.ordinals.set(edge, read.index + 1);
        if (!placeHidden(read, edge, byId, guard, notes)) guard.withhold = true;
      }
      done += batch.length;
    }
  } catch (error) {
    session.note(error);
    guard.withhold = true;
  }
  session.end(done);
  return guard;
}

/** True when the package explains its paragraph: every reference, and each thread once. */
function placeHidden(
  read: HiddenRead,
  edge: RawParagraph,
  byId: ReadonlyMap<string, readonly Live[]>,
  guard: HiddenGuard,
  notes: PackageNotes,
): boolean {
  const { paragraph } = read;
  const found = readWordCommentParagraphPackage(read.ooxml.value, {
    rangeText: paragraph.text,
    identityText: read.identity.value,
    inCell: edge.nesting > 0,
    ...(edge.cell ? { cellIndex: edge.cell.cell } : {}),
  });
  notes.note(found);
  // A view proves that each U+0005 of paragraph.text is a reference the package holds.
  if (!found?.views[0]) return false;
  const replies = new Set(
    found.comments.flatMap((c) => (c.parentWId ? [c.wId] : [])),
  );
  let explained = true;
  for (const span of found.spans) {
    if (replies.has(span.wId)) continue;
    const threads = span.commentId ? (byId.get(span.commentId) ?? []) : [];
    const placement =
      threads.length === 1 ? placeBySpan(found, found.spans, threads[0]) : null;
    if (placement?.status !== "placed") {
      explained = false;
      continue;
    }
    const [thread] = threads;
    const { start, end } = placement.offsets;
    const tail =
      paragraph.text[end.range] === REFERENCE_MARK ? REFERENCE_MARK : "";
    thread.first = paragraph;
    thread.last = paragraph;
    thread.record.placement = placement;
    guard.anchors.set(thread, {
      rangeText: paragraph.text.slice(start.range, end.range) + tail,
      first: edge,
      last: edge,
    });
  }
  return explained;
}

async function readAnchors(
  context: Word.RequestContext,
  session: Session,
  live: readonly Live[],
  inventory: WordCommentInventory,
  budgetMs: number,
  hidden: HiddenGuard | null,
) {
  const ranged = live.filter((thread) => !hidden?.anchors.has(thread));
  const reading = hidden?.withhold ? [] : ranged;
  session.diagnostics.counts.anchorsWithheld = ranged.length - reading.length;
  session.begin("anchors", reading.length, budgetMs);
  const raw = new Map<Live, RawAnchor>(hidden?.anchors ?? []);
  let done = 0;
  for (const batch of chunks(reading, WORD_COMMENT_SYNC_THREADS)) {
    if (session.spent()) break;
    const queued = batch.map((thread) => queueAnchor(thread));
    try {
      await session.sync();
      batch.forEach((thread, i) => raw.set(thread, queued[i]()));
    } catch (error) {
      session.note(error);
      for (const thread of batch) {
        const read = queueAnchor(thread);
        try {
          await session.sync();
          raw.set(thread, read());
        } catch (single) {
          session.note(single);
          session.diagnostics.counts.anchorsFailed += 1;
        }
      }
    }
    done += batch.length;
    session.advance(done);
  }
  session.diagnostics.counts.anchorsSkipped = reading.length - done;

  const byId = idIndex(inventory);
  const ordinals = new Map<RawParagraph, number>(hidden?.ordinals ?? []);
  for (const anchor of raw.values())
    for (const edge of [anchor.first, anchor.last]) {
      const ordinal = edge.id ? byId.get(edge.id) : undefined;
      if (ordinal !== undefined) ordinals.set(edge, ordinal);
    }
  // A paragraph placed for its hidden text gets no range of its own, not even to prove an ordinal.
  const byText = await proveByText(
    context,
    session,
    reading,
    raw,
    inventory,
    ordinals,
  );

  const nesting =
    inventory.paragraphs.every((p) => p.nesting !== undefined) &&
    inventory.paragraphs.length > 0
      ? inventory.paragraphs.map((p) => p.nesting ?? 0)
      : byText.nesting;
  const tables = nesting ? tableNumbers(nesting) : null;
  const refOf = (edge: RawParagraph): WordCommentParagraphRef => {
    const ordinal = ordinals.get(edge) ?? null;
    return {
      ordinal,
      via: ordinal === null ? null : byText.proven.has(edge) ? "text" : "id",
      rangeText: edge.rangeText,
      nesting: edge.nesting,
      cell: edge.cell,
      table:
        ordinal !== null && edge.nesting === 1
          ? (tables?.[ordinal - 1] ?? null)
          : null,
    };
  };
  for (const [thread, anchor] of raw) {
    const first = refOf(anchor.first);
    const last = refOf(anchor.last);
    thread.record.anchor = {
      rangeText: anchor.rangeText,
      first,
      last,
      single:
        anchor.first === anchor.last ||
        (!!anchor.first.id && anchor.first.id === anchor.last.id) ||
        (first.ordinal !== null && first.ordinal === last.ordinal) ||
        byText.same.get(thread) === true,
    };
  }
  session.end(done);
}

/**
 * Without a usable id, a paragraph whose getText() equals exactly one inventory paragraph's text
 * takes that ordinal once compareLocationWith shows the live paragraph there is the same one.
 */
async function proveByText(
  context: Word.RequestContext,
  session: Session,
  live: readonly Live[],
  raw: ReadonlyMap<Live, RawAnchor>,
  inventory: WordCommentInventory,
  ordinals: Map<RawParagraph, number>,
): Promise<{
  proven: Set<RawParagraph>;
  same: Map<Live, boolean>;
  nesting: number[] | null;
}> {
  const proven = new Set<RawParagraph>();
  const same = new Map<Live, boolean>();
  const pending: { edge: RawParagraph; paragraph: Word.Paragraph }[] = [];
  const unsure: Live[] = [];
  for (const thread of live) {
    const anchor = raw.get(thread);
    if (!anchor || !thread.first || !thread.last) continue;
    if (!ordinals.has(anchor.first))
      pending.push({ edge: anchor.first, paragraph: thread.first });
    if (!ordinals.has(anchor.last))
      pending.push({ edge: anchor.last, paragraph: thread.last });
    if (!anchor.first.id && !anchor.last.id) unsure.push(thread);
  }
  const nested = [...raw.values()].some((a) => a.first.nesting > 0);
  const needsNesting =
    nested && inventory.paragraphs.some((p) => p.nesting === undefined);
  const texted = inventory.paragraphs.some((p) => p.text !== undefined);
  if ((pending.length === 0 || !texted) && unsure.length === 0 && !needsNesting)
    return { proven, same, nesting: null };
  if (session.spent()) return { proven, same, nesting: null };

  const body = context.document.body.paragraphs;
  body.load("items/tableNestingLevel");
  const texts = texted
    ? pending.map(({ paragraph }) => paragraph.getText())
    : [];
  const relations = unsure.map((thread) =>
    thread
      .first!.getRange("Whole")
      .compareLocationWith(thread.last!.getRange("Whole")),
  );
  try {
    await session.sync();
  } catch (error) {
    session.note(error);
    return { proven, same, nesting: null };
  }
  unsure.forEach((thread, i) =>
    same.set(thread, relations[i].value === "Equal"),
  );
  const items = body.items;
  const aligned = items.length === inventory.paragraphs.length;
  const nesting = aligned ? items.map((p) => p.tableNestingLevel) : null;

  const byText = new Map<string, number[]>();
  for (const p of inventory.paragraphs)
    if (p.text !== undefined)
      byText.set(p.text, [...(byText.get(p.text) ?? []), p.ordinal]);
  const proofs: {
    edge: RawParagraph;
    ordinal: number;
    relation: ReturnType<Word.Range["compareLocationWith"]>;
  }[] = [];
  pending.forEach(({ edge, paragraph }, i) => {
    const candidates = texts[i] ? byText.get(texts[i].value) : undefined;
    if (!aligned || candidates?.length !== 1) return;
    const ordinal = candidates[0];
    proofs.push({
      edge,
      ordinal,
      relation: items[ordinal - 1]
        .getRange("Whole")
        .compareLocationWith(paragraph.getRange("Whole")),
    });
  });
  if (proofs.length > 0)
    try {
      await session.sync();
      for (const { edge, ordinal, relation } of proofs)
        if (relation.value === "Equal") {
          ordinals.set(edge, ordinal);
          proven.add(edge);
        }
    } catch (error) {
      session.note(error);
    }
  return { proven, same, nesting };
}

const BEFORE: ReadonlySet<string> = new Set([
  "Before",
  "AdjacentBefore",
  "OverlapsBefore",
  "Contains",
  "ContainsEnd",
  "InsideStart",
]);
const AFTER: ReadonlySet<string> = new Set([
  "After",
  "AdjacentAfter",
  "OverlapsAfter",
  "Inside",
  "InsideEnd",
  "ContainsStart",
]);

function byId(a: WordCommentThreadRecord, b: WordCommentThreadRecord) {
  const x = Number(a.id);
  const y = Number(b.id);
  return Number.isFinite(x) && Number.isFinite(y) && x !== y
    ? x - y
    : a.id.localeCompare(b.id);
}

/** Two anchors placed from one paragraph's package, by their offsets in it. */
function offsetOrder(a: Live, b: Live): number {
  const x = a.record.placement;
  const y = b.record.placement;
  if (x?.status !== "placed" || y?.status !== "placed" || a.first !== b.first)
    return 0;
  return (
    x.offsets.start.range - y.offsets.start.range ||
    x.offsets.end.range - y.offsets.end.range
  );
}

/**
 * Document order of anchor starts, then ends: ordinals first, and compareLocationWith between the
 * comments' ranges where two start in one paragraph or one has no ordinal; anchors placed for
 * hidden text have no range, and their offsets decide. The id breaks ties that none decides, so
 * the order never depends on the order Word lists items in.
 */
async function orderThreads(
  session: Session,
  live: readonly Live[],
): Promise<Live[]> {
  const anchored = live.filter(
    (thread) =>
      (thread.range || thread.record.placement) && thread.record.anchor,
  );
  const placed = new Set(anchored);
  const ordinalOf = (thread: Live) =>
    thread.record.anchor?.first.ordinal ?? null;
  const pairs: [Live, Live][] = [];
  const groups = new Map<number, Live[]>();
  const unknown: Live[] = [];
  for (const thread of anchored) {
    const ordinal = ordinalOf(thread);
    if (ordinal === null) unknown.push(thread);
    else groups.set(ordinal, [...(groups.get(ordinal) ?? []), thread]);
  }
  const ranged = (a: Live, b: Live) => !!a.range && !!b.range;
  for (const group of [...groups.values(), unknown])
    for (let i = 0; i < group.length; i += 1)
      for (let j = i + 1; j < group.length; j += 1)
        if (ranged(group[i], group[j])) pairs.push([group[i], group[j]]);
  for (const thread of unknown)
    for (const other of anchored)
      if (ordinalOf(other) !== null && ranged(thread, other))
        pairs.push([thread, other]);
  const asked = pairs.slice(0, WORD_COMMENT_ORDER_PAIRS_MAX);
  session.begin("order", pairs.length);
  const relations = new Map<Live, Map<Live, string>>();
  const remember = (a: Live, b: Live, value: string) => {
    if (!relations.has(a)) relations.set(a, new Map());
    relations.get(a)!.set(b, value);
  };
  let done = 0;
  for (const chunk of chunks(asked, WORD_COMMENT_ORDER_PAIRS_PER_SYNC)) {
    const results = chunk.map(([a, b]) =>
      a.range!.compareLocationWith(b.range!),
    );
    try {
      await session.sync();
      chunk.forEach(([a, b], i) => remember(a, b, String(results[i].value)));
      done += chunk.length;
    } catch (error) {
      session.note(error);
    }
  }
  session.end(done);

  const relationOf = (a: Live, b: Live): number => {
    const forward = relations.get(a)?.get(b);
    if (forward !== undefined)
      return BEFORE.has(forward) ? -1 : AFTER.has(forward) ? 1 : 0;
    const backward = relations.get(b)?.get(a);
    if (backward !== undefined)
      return BEFORE.has(backward) ? 1 : AFTER.has(backward) ? -1 : 0;
    return 0;
  };
  const sorted = [...live].sort((a, b) => {
    if (placed.has(a) !== placed.has(b)) return placed.has(a) ? -1 : 1;
    const x = ordinalOf(a);
    const y = ordinalOf(b);
    if (x !== null && y !== null && x !== y) return x - y;
    return offsetOrder(a, b) || relationOf(a, b) || byId(a.record, b.record);
  });
  sorted.forEach((thread, i) => {
    thread.record.order = i;
  });
  return sorted;
}

function repliesOf(
  thread: Live,
  items: readonly Word.CommentReply[],
  session: Session,
) {
  const seen = new Set([thread.record.id]);
  const replies: WordCommentEntryRecord[] = [];
  let repeated = false;
  for (const item of items) {
    const entry = entryOf(item);
    if (seen.has(entry.id)) {
      repeated = true;
      continue;
    }
    seen.add(entry.id);
    replies.push(entry);
  }
  thread.record.replies = replies;
  if (repeated) {
    session.diagnostics.counts.repliesRepeated += 1;
    thread.record.readOnly ??= "replies-repeated";
  }
}

/** A reply list that fails to load costs only its own thread, which becomes read-only (#3608). */
async function readReplies(
  session: Session,
  targets: readonly Live[],
  budgetMs: number,
) {
  session.begin("replies", targets.length, budgetMs);
  let done = 0;
  for (const batch of chunks(targets, WORD_COMMENT_SYNC_THREADS)) {
    if (session.spent()) break;
    const lists = batch.map(({ comment }) => {
      const replies = comment.replies;
      replies.load(REPLY_FIELDS);
      return replies;
    });
    try {
      await session.sync();
      batch.forEach((thread, i) => repliesOf(thread, lists[i].items, session));
    } catch (error) {
      session.note(error);
      for (const thread of batch) {
        const replies = thread.comment.replies;
        replies.load(REPLY_FIELDS);
        try {
          await session.sync();
          repliesOf(thread, replies.items, session);
        } catch (single) {
          session.note(single);
          session.diagnostics.counts.repliesFailed += 1;
          thread.record.readOnly ??= "replies-failed";
        }
      }
    }
    done += batch.length;
    session.advance(done);
  }
  session.end(done);
}

const unplacedSource = (rangeText: string) =>
  ({ kind: "unplaced", rangeText }) as const;

function notPlaced(
  thread: Live,
  status: "unplaced" | "budget" | "failed",
): WordCommentPlacement {
  const source = unplacedSource(thread.record.anchor?.rangeText ?? "");
  return { status, anchor: wordCommentAnchorText(source), source };
}

function placedFrom(
  source: WordCommentPlacedSource,
  offsets: WordCommentOffsets,
  joinedBy: WordCommentJoin | "text",
): WordCommentPlacement {
  return {
    status: "placed",
    joinedBy,
    anchor: wordCommentAnchorText(source, {
      edgeChars: WORD_COMMENT_QUOTE_EDGE_CHARS,
    }),
    source,
    offsets,
  };
}

function placeBySpan(
  read: WordCommentPackageRead | null,
  spans: readonly WordCommentSpan[],
  thread: Live,
): WordCommentPlacement | null {
  const span = spans.find((s) => s.commentId === thread.record.id);
  const { start, end } = span ?? {};
  const first = start && read?.views[start.paragraph];
  const last = end && read?.views[end.paragraph];
  if (
    !span ||
    !start ||
    !end ||
    !first ||
    !last ||
    start.range === null ||
    start.visible === null ||
    end.range === null ||
    end.visible === null
  )
    return null;
  return placedFrom(
    wordCommentSourceBetween(
      first,
      start.visible,
      start.paragraph === end.paragraph ? undefined : last,
      end.visible,
      span.multiCell,
    ),
    {
      start: { range: start.range, visible: start.visible },
      end: { range: end.range, visible: end.visible },
    },
    span.joinedBy ?? "durableId",
  );
}

function multiCell(anchor: WordCommentCoarseAnchor): boolean {
  const { first, last } = anchor;
  return (
    !!first.cell &&
    !!last.cell &&
    (first.cell.row !== last.cell.row ||
      first.cell.cell !== last.cell.cell ||
      first.table !== last.table)
  );
}

/** Contract §5's last resort: the range's text occurs once where it must. */
function placeByText(
  thread: Live,
  first: WordParagraphView | null,
  last?: WordParagraphView | null,
): WordCommentPlacement | null {
  const anchor = thread.record.anchor;
  if (!anchor || !first || last === null) return null;
  const span = wordCommentTextSpan(
    anchor.rangeText,
    first.rangeText,
    last?.rangeText,
  );
  if (!span) return null;
  const start = first.visibleAt[span.start];
  const end = (last ?? first).visibleAt[span.end];
  return placedFrom(
    wordCommentSourceBetween(first, start, last, end, multiCell(anchor)),
    {
      start: { range: span.start, visible: start },
      end: { range: span.end, visible: end },
    },
    "text",
  );
}

interface Job {
  threads: Live[];
  start: Step;
  finished: boolean;
}

/** The roots a content join pairs spans with, in document order (never items order). */
function listedFor(threads: readonly Live[]) {
  return threads.map(({ record }) => ({
    id: record.id,
    content: record.content,
    rangeText: record.anchor?.rangeText,
  }));
}

function textsOf(
  paragraph: Word.Paragraph,
  identity: ReturnType<Word.Paragraph["getText"]>,
  ref: WordCommentParagraphRef,
): WordParagraphTexts & { identityText: string; cellIndex?: number } {
  return {
    rangeText: paragraph.text,
    identityText: identity.value,
    inCell: ref.nesting > 0,
    ...(ref.cell ? { cellIndex: ref.cell.cell } : {}),
  };
}

interface ExactContext {
  sorted: readonly Live[];
  /** PC and Mac read a multi-paragraph range's package; ERMAIN-932 saw web engines rewrite it. */
  rangePackages: boolean;
  notePackage: (read: WordCommentPackageRead | null) => void;
}

/** What the packages read show: dateUtc per comment, and whether the file has any (legacy). */
class PackageNotes {
  private readonly utc = new Map<string, boolean>();
  private withUtc = 0;
  private withoutUtc = 0;
  /** Packages read that held comments. */
  private packages = 0;

  note(read: WordCommentPackageRead | null) {
    if (!read || read.comments.length === 0) return;
    this.packages += 1;
    for (const comment of read.comments) {
      const has = comment.dateUtc !== null;
      if (has) this.withUtc += 1;
      else this.withoutUtc += 1;
      if (comment.commentId !== null) this.utc.set(comment.commentId, has);
    }
  }

  legacy(): boolean | null {
    return wordCommentLegacy({
      withUtc: this.withUtc,
      withoutUtc: this.withoutUtc,
    });
  }

  /** One more package could still show a dateUtc that every package so far lacked. */
  undecided(): boolean {
    return this.withUtc === 0 && this.packages < WORD_COMMENT_LEGACY_PACKAGES;
  }

  dateUtc(): WordCommentDateUtc {
    return {
      byId: new Map(this.utc),
      otherwise: this.legacy() === true ? false : null,
    };
  }
}

/** Spans no commentsIds entry named, which only a content join can pair with listed threads. */
const unjoined = (read: WordCommentPackageRead) =>
  read.spans.some((span) => !span.commentId);

function samePlace(a: WordCommentParagraphRef, b: WordCommentParagraphRef) {
  return a.ordinal !== null && a.ordinal === b.ordinal;
}

/** One paragraph's package places every requested thread anchored inside it. */
function paragraphJob(threads: Live[], ctx: ExactContext): Job {
  const job: Job = { threads, finished: false, start: () => null };
  job.start = () => {
    const [head] = job.threads;
    const anchor = head.record.anchor!;
    const paragraph = head.first!;
    paragraph.load("text");
    const identity = paragraph.getText(WORD_SELECTION_TEXT_OPTIONS);
    const ooxml = paragraph.getOoxml();
    return () => {
      const texts = textsOf(paragraph, identity, anchor.first);
      const read = readWordCommentParagraphPackage(ooxml.value, texts);
      ctx.notePackage(read);
      const spans =
        read && unjoined(read)
          ? joinWordCommentSpansByContent(
              read,
              listedFor(
                ctx.sorted.filter(
                  (t) =>
                    t.record.anchor?.single &&
                    samePlace(t.record.anchor.first, anchor.first),
                ),
              ),
            )
          : (read?.spans ?? []);
      const view = read?.views[0] ?? wordParagraphViewFromText(texts);
      for (const thread of job.threads)
        thread.record.placement =
          placeBySpan(read, spans, thread) ??
          placeByText(thread, view) ??
          notPlaced(thread, "unplaced");
      job.finished = true;
      return null;
    };
  };
  return job;
}

/**
 * The web's route for an anchor across paragraphs, and every host's fallback: the range's text
 * against the first and last paragraph's views, from their texts or, failing that, their own
 * packages. The web never reads a multi-paragraph range's OOXML (ERMAIN-932).
 */
function textJob(thread: Live, ctx: ExactContext): Step {
  const anchor = thread.record.anchor!;
  const ends = [
    [thread.first!, anchor.first],
    [thread.last!, anchor.last],
  ] as const;
  const identities = ends.map(([paragraph]) => {
    paragraph.load("text");
    return paragraph.getText(WORD_SELECTION_TEXT_OPTIONS);
  });
  return () => {
    const texts = ends.map(([paragraph, ref], i) =>
      textsOf(paragraph, identities[i], ref),
    );
    const views = texts.map((t) => wordParagraphViewFromText(t));
    const packages = ends.map(([paragraph], i) =>
      views[i] ? null : paragraph.getOoxml(),
    );
    const finish = () => {
      thread.record.placement =
        placeByText(thread, views[0], views[1]) ??
        notPlaced(thread, "unplaced");
      return null;
    };
    if (packages.every((p) => p === null)) return finish();
    return () => {
      packages.forEach((ooxml, i) => {
        if (!ooxml) return;
        const read = readWordCommentParagraphPackage(ooxml.value, texts[i]);
        ctx.notePackage(read);
        views[i] = read?.views[0] ?? null;
      });
      return finish();
    };
  };
}

/** Desktop: the package of the range from the first to the last paragraph holds the marks (F-13). */
function rangeJob(thread: Live, ctx: ExactContext): Job {
  const job: Job = { threads: [thread], finished: false, start: () => null };
  const done = (step: Step | null): Step | null => {
    if (step) return () => done(step());
    job.finished = true;
    return null;
  };
  job.start = () => {
    const anchor = thread.record.anchor!;
    const { first, last } = anchor;
    const span =
      first.ordinal !== null && last.ordinal !== null
        ? last.ordinal - first.ordinal + 1
        : null;
    if (
      !ctx.rangePackages ||
      (span !== null && span > WORD_COMMENT_RANGE_PARAGRAPHS_MAX)
    )
      return done(textJob(thread, ctx));
    const whole = thread
      .first!.getRange("Whole")
      .expandTo(thread.last!.getRange("Whole"));
    const paragraphs = whole.paragraphs;
    paragraphs.load("items/text,items/tableNestingLevel");
    const ooxml = whole.getOoxml();
    return () => {
      const items = paragraphs.items;
      if (items.length < 2 || items.length > WORD_COMMENT_RANGE_PARAGRAPHS_MAX)
        return done(textJob(thread, ctx));
      const identities = items.map((p) =>
        p.getText(WORD_SELECTION_TEXT_OPTIONS),
      );
      return () => {
        const texts = items.map((p, i) => ({
          rangeText: p.text,
          identityText: identities[i].value,
          inCell: p.tableNestingLevel > 0,
        }));
        const read = readWordCommentRangePackage(ooxml.value, texts);
        ctx.notePackage(read);
        const spans =
          read && unjoined(read)
            ? joinWordCommentSpansByContent(
                read,
                listedFor(
                  ctx.sorted.filter((t) => {
                    const a = t.record.anchor;
                    return (
                      !!a &&
                      first.ordinal !== null &&
                      last.ordinal !== null &&
                      a.first.ordinal !== null &&
                      a.last.ordinal !== null &&
                      a.first.ordinal >= first.ordinal &&
                      a.last.ordinal <= last.ordinal
                    );
                  }),
                ),
              )
            : (read?.spans ?? []);
        const views = [0, items.length - 1].map(
          (i) => read?.views[i] ?? wordParagraphViewFromText(texts[i]),
        );
        thread.record.placement =
          placeBySpan(read, spans, thread) ??
          placeByText(thread, views[0], views[1]) ??
          notPlaced(thread, "unplaced");
        return done(null);
      };
    };
  };
  return job;
}

function jobsFor(asked: readonly Live[], ctx: ExactContext): Job[] {
  const jobs: Job[] = [];
  const byParagraph = new Map<string, Job>();
  for (const thread of asked) {
    const anchor = thread.record.anchor;
    if (thread.record.placement) continue;
    if (!anchor || !thread.first || !thread.last) {
      thread.record.placement = notPlaced(thread, "failed");
      continue;
    }
    if (!anchor.single) {
      jobs.push(rangeJob(thread, ctx));
      continue;
    }
    const key =
      anchor.first.ordinal !== null
        ? `o${anchor.first.ordinal}`
        : `t${thread.record.id}:${thread.record.order}`;
    const job = byParagraph.get(key);
    if (job) job.threads.push(thread);
    else {
      const created = paragraphJob([thread], ctx);
      byParagraph.set(key, created);
      jobs.push(created);
    }
  }
  return jobs;
}

async function runSteps(session: Session, starts: readonly Step[]) {
  let steps = starts.map((start) => start()).filter((s): s is Step => !!s);
  while (steps.length > 0) {
    await session.sync();
    steps = steps.map((step) => step()).filter((s): s is Step => !!s);
  }
}

/**
 * Exact anchors for the requested threads, in the order asked, a few paragraphs per sync. Past the
 * budget the rest keep their paragraph-level anchor, marked as such. The packages read go to notes.
 */
async function placeExact(
  session: Session,
  sorted: readonly Live[],
  asked: readonly Live[],
  budgetMs: number,
  notes: PackageNotes,
  desktop: boolean,
) {
  const ctx: ExactContext = {
    sorted,
    rangePackages: desktop,
    notePackage: (read) => notes.note(read),
  };
  session.begin("exact", asked.length, budgetMs);
  if (asked.length === 0) {
    session.end(0);
    return;
  }
  const jobs = jobsFor(asked, ctx);
  let done = asked.length - jobs.reduce((n, job) => n + job.threads.length, 0);
  for (let i = 0; i < jobs.length; i += WORD_COMMENT_EXACT_BATCH) {
    if (session.spent()) {
      for (const job of jobs.slice(i))
        for (const thread of job.threads)
          thread.record.placement = notPlaced(thread, "budget");
      break;
    }
    const batch = jobs.slice(i, i + WORD_COMMENT_EXACT_BATCH);
    try {
      await runSteps(
        session,
        batch.map((job) => job.start),
      );
    } catch (error) {
      session.note(error);
      for (const job of batch.filter((j) => !j.finished))
        try {
          await runSteps(session, [job.start]);
        } catch (single) {
          session.note(single);
          for (const thread of job.threads)
            thread.record.placement = notPlaced(thread, "failed");
        }
    }
    done += batch.reduce((n, job) => n + job.threads.length, 0);
    session.advance(done);
  }
  session.end(done);
}

/**
 * Desktop: commented paragraphs' packages, one per sync, until one shows a dateUtc or enough show
 * none; paragraphs the exact phase read already count.
 */
async function probeLegacy(
  session: Session,
  sorted: readonly Live[],
  notes: PackageNotes,
) {
  const seen = new Set<string>();
  const candidates = sorted.filter((thread) => {
    const anchor = thread.record.anchor;
    if (!anchor?.single || !thread.first || thread.record.placement)
      return false;
    const key =
      anchor.first.ordinal === null
        ? `t${thread.record.id}`
        : `o${anchor.first.ordinal}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (candidates.length === 0) return;
  session.begin("legacy", candidates.length);
  let done = 0;
  for (const thread of candidates) {
    if (!notes.undecided()) break;
    const paragraph = thread.first!;
    const ref = thread.record.anchor!.first;
    paragraph.load("text");
    const ooxml = paragraph.getOoxml();
    try {
      await session.sync();
    } catch (error) {
      session.note(error);
      break;
    }
    notes.note(
      readWordCommentParagraphPackage(ooxml.value, {
        rangeText: paragraph.text,
        inCell: ref.nesting > 0,
        ...(ref.cell ? { cellIndex: ref.cell.cell } : {}),
      }),
    );
    done += 1;
  }
  session.end(done);
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The copyable report and the native gate's record: counts, timings and error names only. */
export function renderWordCommentReadReport(
  diagnostics: WordCommentReadDiagnostics,
): string {
  const { counts } = diagnostics;
  const legacy =
    diagnostics.legacy === null ? "unknown" : diagnostics.legacy ? "yes" : "no";
  const listed = (entries: [number, string][]) =>
    entries
      .filter(([n]) => n > 0)
      .map(([n, label]) => `${label} ${n}`)
      .join(", ");
  const issues = listed([
    [counts.repliesFailed, "replies failed"],
    [counts.repliesRepeated, "replies repeated"],
    [counts.idsRepeated, "ids repeated"],
    [counts.anchorsFailed, "anchors failed"],
    [counts.anchorsSkipped, "anchors skipped"],
    [counts.anchorsWithheld, "anchors withheld for hidden text"],
    [counts.positionUnknown, "position unknown"],
  ]);
  const placement = listed([
    [counts.placed, "placed"],
    [counts.hiddenParagraphs, "paragraphs with hidden text from packages"],
    [counts.matchedByContent, "by content"],
    [counts.paragraphsByText, "paragraphs by text"],
    [counts.unplaced, "unplaced"],
    [counts.budget, "over budget"],
    [counts.failed, "failed"],
  ]);
  return [
    `Word comment read: ${plural(diagnostics.threads, "thread")}, ${plural(diagnostics.replies, "reply", "replies")}`,
    `Host: ${diagnostics.host} · inventory ${diagnostics.inventory ?? "none"} · legacy ${legacy} · ${diagnostics.totalMs} ms`,
    ...diagnostics.phases.map(
      (p) =>
        `${p.phase}: ${p.ms} ms, ${plural(p.syncs, "sync")}, ${p.done}/${p.total}${
          p.budgetMs === undefined
            ? ""
            : ` (budget ${p.budgetMs} ms${p.exhausted ? ", used up" : ""})`
        }`,
    ),
    ...(placement ? [`Anchors: ${placement}`] : []),
    ...(issues ? [`Issues: ${issues}`] : []),
    ...diagnostics.errors.map((e) => `Error: ${describeError(e)}`),
  ].join("\n");
}
