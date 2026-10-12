/**
 * Word comment context as the add-in sends it and the Erato web app reads it
 * back from stored chats: one JSON envelope for the anchored_comments,
 * comments_json and comment_map arguments and the word_read_comments result,
 * and one thread record for thread_json. Comment text, gists and author names
 * are other people's text; it stays inside these JSON values so the untrusted
 * frame can wrap them whole.
 */

export const WORD_COMMENT_THREAD_FACET_ID = "word_comment_thread";
export const WORD_READ_COMMENTS_TOOL = "word_read_comments";

/** On word_selection: the selection's own threads and the coverage line. */
export const WORD_ANCHORED_COMMENTS_ARG = "anchored_comments";
/** On word_comment_thread: the picked thread's record. */
export const WORD_THREAD_JSON_ARG = "thread_json";
/** On word_comment_thread: the envelope around the picked thread. */
export const WORD_COMMENTS_JSON_ARG = "comments_json";
/** On the document facets: one row per thread for the whole document. */
export const WORD_COMMENT_MAP_ARG = "comment_map";

export const WORD_COMMENT_CONTEXT_VERSION = 1;

/** The backend rejects any single action-facet argument above this. */
export const WORD_COMMENT_ARG_MAX_BYTES = 64 * 1024;
export const WORD_COMMENT_ARG_TARGET_BYTES = 24 * 1024;
export const WORD_READ_COMMENTS_PAGE_BYTES = 20 * 1024;
export const WORD_COMMENT_TEXT_MAX_CHARS = 1200;
/** Replies kept after the root when a thread is cut; the rest are counted in omitted_replies. */
export const WORD_COMMENT_KEPT_REPLIES = 8;
/** Threads above and below that a near read returns without a user gesture. */
export const WORD_COMMENT_NEAR_LIMIT = 3;
export const WORD_COMMENT_GIST_CHARS = 100;
export const WORD_READ_COMMENTS_DIGEST_MAX_BYTES = 512;
export const WORD_COMMENT_SECTION_SEPARATOR = " > ";

const THREAD_REF = /^t[0-9a-z]{2,3}$/u;
const ENTRY_REF = /^t[0-9a-z]{2,3}\.(?:0|[1-9]\d*)$/u;

/** A session ref such as "t7k": a name, never a position or a time. */
export const isWordCommentThreadRef = (value: unknown): value is string =>
  typeof value === "string" && THREAD_REF.test(value);

/** "t7k.0" is the thread's comment, "t7k.1" onwards its replies. */
export const isWordCommentEntryRef = (value: unknown): value is string =>
  typeof value === "string" && ENTRY_REF.test(value);

export type WordCommentScope = "selection" | "thread" | "document" | "read";
export type WordCommentStatus = "open" | "resolved";

/** Where an anchor lies relative to the captured selection, from coordinates. */
export type WordCommentVs =
  | "before"
  | "after"
  | "inside"
  | "contains"
  | "overlaps_start"
  | "overlaps_end"
  | "at_caret";

export type WordCommentContainer =
  | "body"
  | { table: number; row: number; cell: number };

export interface WordCommentWhere {
  /** The review facet's 1-based paragraph number of the anchor start. */
  para: number;
  through?: number;
  /** Visible anchor text; "" for a point comment. */
  quote: string;
  occurrence?: number;
  point?: true;
  /** The text just before a point comment. */
  after?: string;
  vs?: WordCommentVs;
  /** Paragraphs between the anchor and the nearest selection edge. */
  away?: number;
  in: WordCommentContainer;
  overlaps?: string[];
  multi_cell?: true;
  /** The quote could not be placed in the paragraph's text. */
  position?: "unknown";
  /** The v2 kept-item marker number the selection shows for this comment. */
  marker?: number;
  /** The v1 snapshot block the anchor is in. */
  block?: string;
}

export interface WordCommentEntry {
  /** 0 is the thread's comment; replies follow in Word's order. */
  n: number;
  by: string;
  me?: true;
  /** The text starts with the configured or a past Erato label. */
  label?: true;
  /** A label, the AI-author template or the bare author "Erato": a hint, not proof. */
  likely_erato?: true;
  /** Ends in Z only when Word had the UTC time; null when Word gave none. */
  at: string | null;
  /** at is the author's or the host's local clock, not comparable across authors. */
  tz?: "unknown";
  /** Dense 1-based rank of at over every timed entry in the document. */
  age: number | null;
  /** Shares its age with another entry, often at desktop minute precision. */
  tie?: true;
  /** The calendar day of at in user_tz. */
  day: string | null;
  day_uncertain?: true;
  same_author_as_root?: true;
  text: string;
  cut?: true;
}

export interface WordCommentThread {
  id: string;
  /** Dense 1-based document-order rank among all threads in the document. */
  pos: number;
  status: WordCommentStatus;
  where: WordCommentWhere;
  first_at: string | null;
  /** The latest entry's time; Word records no edit or resolve time. */
  last_at: string | null;
  entries: WordCommentEntry[];
  read_only?: true;
  matched_by_content?: true;
  omitted_replies?: number;
}

/** One comment-map row: a thread listed without its full text. */
export interface WordCommentMapRow {
  id: string;
  /** The heading chain, outermost first, joined by WORD_COMMENT_SECTION_SEPARATOR. */
  sec?: string;
  para: number;
  /** Short anchor quote. */
  q?: string;
  by: string;
  st: WordCommentStatus;
  /** Reply count. */
  r: number;
  /** last_at of the thread. */
  at: string | null;
  /** Gist of the thread's comment, about WORD_COMMENT_GIST_CHARS long. */
  g?: string;
}

export interface WordCommentCoverage {
  threads_total: number;
  open: number;
  resolved: number;
  sent_full: number;
  sent_index_only: number;
  not_shown: number;
  cut: { texts: number; replies: number };
  complete: boolean;
  /** What was sent, listed and left out, without any comment text. */
  line: string;
}

export interface WordCommentSelection {
  para: [number, number];
  caret: boolean;
}

export interface WordCommentEnvelope {
  v: typeof WORD_COMMENT_CONTEXT_VERSION;
  scope: WordCommentScope;
  now: string;
  user_tz: string;
  selection?: WordCommentSelection;
  coverage: WordCommentCoverage;
  /** Threads with their text, in document order. */
  threads: WordCommentThread[];
  /** Threads listed by position only, in document order. */
  index: WordCommentMapRow[];
  /** The file has no stable comment ids, so threads are matched by content. */
  legacy?: true;
}

export type WordCommentCarrier =
  | typeof WORD_COMMENT_THREAD_FACET_ID
  | typeof WORD_ANCHORED_COMMENTS_ARG
  | typeof WORD_COMMENT_MAP_ARG;

export interface WordCommentContextSummary {
  carrier: WordCommentCarrier;
  /** Null for a thread facet that carried only thread_json. */
  envelope: WordCommentEnvelope | null;
  /** Every thread sent with its text, a picked thread first. */
  threads: readonly WordCommentThread[];
  mapCount: number;
  notShown: number;
  selectionThreadCount: number;
  picked: WordCommentThread | null;
}

const IN_SELECTION: ReadonlySet<WordCommentVs> = new Set([
  "inside",
  "contains",
  "overlaps_start",
  "overlaps_end",
  "at_caret",
]);

export const wordCommentInSelection = (thread: WordCommentThread): boolean =>
  thread.where.vs !== undefined && IN_SELECTION.has(thread.where.vs);

type Fields = Readonly<Record<string, unknown>>;

const SCOPES: ReadonlySet<unknown> = new Set<WordCommentScope>([
  "selection",
  "thread",
  "document",
  "read",
]);
const STATUSES: ReadonlySet<unknown> = new Set<WordCommentStatus>([
  "open",
  "resolved",
]);
const VS: ReadonlySet<unknown> = new Set<WordCommentVs>([
  "before",
  "after",
  ...IN_SELECTION,
]);
const isScope = (value: unknown): value is WordCommentScope =>
  SCOPES.has(value);
const isStatus = (value: unknown): value is WordCommentStatus =>
  STATUSES.has(value);
const isVs = (value: unknown): value is WordCommentVs => VS.has(value);

const fields = (value: unknown): Fields | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isOrdinal = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;
const isNullable =
  <T>(is: (value: unknown) => value is T) =>
  (value: unknown): value is T | null | undefined =>
    value === null || value === undefined || is(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isMaybeString = isNullable(isString);
const isMaybeOrdinal = isNullable(isOrdinal);
const nonNull = <T>(value: T | null): value is T => value !== null;

function trueFlags<K extends string>(
  source: Fields,
  keys: readonly K[],
): Partial<Record<K, true>> {
  const flags: Partial<Record<K, true>> = {};
  for (const key of keys) if (source[key] === true) flags[key] = true;
  return flags;
}

function countsOf<K extends string>(
  source: Fields,
  keys: readonly K[],
): Record<K, number> | null {
  const counts = {} as Record<K, number>;
  for (const key of keys) {
    const value = source[key];
    if (!isCount(value)) return null;
    counts[key] = value;
  }
  return counts;
}

const listOf = <T>(value: unknown, parse: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map((item) => parse(item)).filter(nonNull) : [];

const encoder = new TextEncoder();

function jsonOf(text: string): unknown {
  if (encoder.encode(text).length > WORD_COMMENT_ARG_MAX_BYTES)
    return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const sourceOf = (value: unknown) =>
  fields(typeof value === "string" ? jsonOf(value) : value);

function containerOf(value: unknown): WordCommentContainer | null {
  if (value === "body") return "body";
  const source = fields(value);
  return source &&
    isOrdinal(source.table) &&
    isOrdinal(source.row) &&
    isOrdinal(source.cell)
    ? { table: source.table, row: source.row, cell: source.cell }
    : null;
}

function whereOf(value: unknown): WordCommentWhere | null {
  const source = fields(value);
  const container = containerOf(source?.in);
  if (
    !source ||
    !container ||
    !isOrdinal(source.para) ||
    !isString(source.quote)
  )
    return null;
  const overlaps = listOf(source.overlaps, (ref) =>
    isWordCommentThreadRef(ref) ? ref : null,
  );
  return {
    para: source.para,
    ...(isOrdinal(source.through) && source.through >= source.para
      ? { through: source.through }
      : {}),
    quote: source.quote,
    ...(isOrdinal(source.occurrence) ? { occurrence: source.occurrence } : {}),
    ...trueFlags(source, ["point"]),
    ...(isString(source.after) ? { after: source.after } : {}),
    ...(isVs(source.vs) ? { vs: source.vs } : {}),
    ...(isCount(source.away) ? { away: source.away } : {}),
    in: container,
    ...(overlaps.length > 0 ? { overlaps } : {}),
    ...trueFlags(source, ["multi_cell"]),
    ...(source.position === "unknown" ? { position: "unknown" as const } : {}),
    ...(isOrdinal(source.marker) ? { marker: source.marker } : {}),
    ...(isString(source.block) ? { block: source.block } : {}),
  };
}

function entryOf(value: unknown): WordCommentEntry | null {
  const source = fields(value);
  if (
    !source ||
    !isCount(source.n) ||
    !isString(source.by) ||
    !isString(source.text) ||
    !isMaybeString(source.at) ||
    !isMaybeOrdinal(source.age) ||
    !isMaybeString(source.day)
  )
    return null;
  return {
    n: source.n,
    by: source.by,
    ...trueFlags(source, ["me", "label", "likely_erato"]),
    at: source.at ?? null,
    ...(source.tz === "unknown" ? { tz: "unknown" as const } : {}),
    age: source.age ?? null,
    ...trueFlags(source, ["tie"]),
    day: source.day ?? null,
    ...trueFlags(source, ["day_uncertain", "same_author_as_root"]),
    text: source.text,
    ...trueFlags(source, ["cut"]),
  };
}

function threadOf(value: unknown): WordCommentThread | null {
  const source = fields(value);
  const where = whereOf(source?.where);
  const entries = listOf(source?.entries, entryOf);
  if (
    !source ||
    !where ||
    entries.length === 0 ||
    !isWordCommentThreadRef(source.id) ||
    !isOrdinal(source.pos) ||
    !isStatus(source.status) ||
    !isMaybeString(source.first_at) ||
    !isMaybeString(source.last_at)
  )
    return null;
  return {
    id: source.id,
    pos: source.pos,
    status: source.status,
    where,
    first_at: source.first_at ?? null,
    last_at: source.last_at ?? null,
    entries,
    ...trueFlags(source, ["read_only", "matched_by_content"]),
    ...(isOrdinal(source.omitted_replies)
      ? { omitted_replies: source.omitted_replies }
      : {}),
  };
}

function mapRowOf(value: unknown): WordCommentMapRow | null {
  const source = fields(value);
  if (
    !source ||
    !isWordCommentThreadRef(source.id) ||
    !isOrdinal(source.para) ||
    !isString(source.by) ||
    !isStatus(source.st) ||
    !isCount(source.r) ||
    !isMaybeString(source.at)
  )
    return null;
  return {
    id: source.id,
    ...(isString(source.sec) ? { sec: source.sec } : {}),
    para: source.para,
    ...(isString(source.q) ? { q: source.q } : {}),
    by: source.by,
    st: source.st,
    r: source.r,
    at: source.at ?? null,
    ...(isString(source.g) ? { g: source.g } : {}),
  };
}

const COVERAGE_COUNTS = [
  "threads_total",
  "open",
  "resolved",
  "sent_full",
  "sent_index_only",
  "not_shown",
] as const;

function coverageOf(value: unknown): WordCommentCoverage | null {
  const source = fields(value);
  const counts = source && countsOf(source, COVERAGE_COUNTS);
  const cut = countsOf(fields(source?.cut) ?? {}, ["texts", "replies"]);
  return source &&
    counts &&
    cut &&
    typeof source.complete === "boolean" &&
    isString(source.line)
    ? { ...counts, cut, complete: source.complete, line: source.line }
    : null;
}

function selectionOf(value: unknown): WordCommentSelection | undefined {
  const source = fields(value);
  const para: unknown = source?.para;
  if (
    !source ||
    !Array.isArray(para) ||
    para.length !== 2 ||
    typeof source.caret !== "boolean"
  )
    return undefined;
  const [first, last] = para as unknown[];
  return isOrdinal(first) && isOrdinal(last) && first <= last
    ? { para: [first, last], caret: source.caret }
    : undefined;
}

/**
 * A thread record from thread_json or an object; null when it is not one.
 * Unknown fields are dropped, and so are optional fields with a wrong type.
 */
export function parseWordCommentThread(
  value: unknown,
): WordCommentThread | null {
  return threadOf(sourceOf(value));
}

/**
 * An envelope from an argument's JSON or an object, such as a
 * word_read_comments result; null when it is not one. A thread, entry or row
 * that is not valid is left out, not the whole envelope.
 */
export function parseWordCommentEnvelope(
  value: unknown,
): WordCommentEnvelope | null {
  const source = sourceOf(value);
  const coverage = coverageOf(source?.coverage);
  if (
    !source ||
    !coverage ||
    source.v !== WORD_COMMENT_CONTEXT_VERSION ||
    !isScope(source.scope) ||
    !isString(source.now) ||
    !isString(source.user_tz)
  )
    return null;
  const selection = selectionOf(source.selection);
  return {
    v: WORD_COMMENT_CONTEXT_VERSION,
    scope: source.scope,
    now: source.now,
    user_tz: source.user_tz,
    ...(selection ? { selection } : {}),
    coverage,
    threads: listOf(source.threads, threadOf),
    index: listOf(source.index, mapRowOf),
    ...trueFlags(source, ["legacy"]),
  };
}

function summaryOf(
  carrier: WordCommentCarrier,
  envelope: WordCommentEnvelope | null,
  picked: WordCommentThread | null,
): WordCommentContextSummary {
  const threads = [
    ...(picked ? [picked] : []),
    ...(envelope?.threads ?? []).filter((thread) => thread.id !== picked?.id),
  ];
  return {
    carrier,
    envelope,
    threads,
    mapCount: envelope?.index.length ?? 0,
    notShown: envelope?.coverage.not_shown ?? 0,
    selectionThreadCount: threads.filter(wordCommentInSelection).length,
    picked,
  };
}

/** An argument the add-in left blank carries nothing; one that is not a string is malformed. */
function carriedArg<T>(
  args: Readonly<Record<string, unknown>>,
  key: string,
  parse: (text: string) => T | null,
): T | null | undefined {
  const value = args[key];
  if (value === undefined || (isString(value) && value.trim() === ""))
    return undefined;
  return isString(value) ? parse(value) : null;
}

/**
 * The comment context a stored request's facet args carry. A thread facet wins
 * over anchored_comments, which wins over comment_map. Null when there is
 * none, or when a carrying argument is malformed or over the argument cap.
 */
export function parseWordCommentContext(
  args: Readonly<Record<string, unknown>> | null | undefined,
): WordCommentContextSummary | null {
  if (!args) return null;
  const picked = carriedArg(args, WORD_THREAD_JSON_ARG, parseWordCommentThread);
  const around = carriedArg(
    args,
    WORD_COMMENTS_JSON_ARG,
    parseWordCommentEnvelope,
  );
  if (picked !== undefined || around !== undefined)
    return picked === null || around === null
      ? null
      : summaryOf(WORD_COMMENT_THREAD_FACET_ID, around ?? null, picked ?? null);
  for (const carrier of [
    WORD_ANCHORED_COMMENTS_ARG,
    WORD_COMMENT_MAP_ARG,
  ] as const) {
    const envelope = carriedArg(args, carrier, parseWordCommentEnvelope);
    if (envelope !== undefined)
      return envelope && summaryOf(carrier, envelope, null);
  }
  return null;
}
