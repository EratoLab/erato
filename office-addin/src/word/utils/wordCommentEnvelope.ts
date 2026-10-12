import {
  WORD_COMMENT_ARG_MAX_BYTES,
  WORD_COMMENT_ARG_TARGET_BYTES,
  WORD_COMMENT_CONTEXT_VERSION,
  WORD_COMMENT_KEPT_REPLIES,
  WORD_COMMENT_TEXT_MAX_CHARS,
} from "@erato/frontend/word-review";

import { wordCommentMapRow } from "./wordCommentMap";
import { wordCommentWhere } from "./wordCommentPositions";

import type { WordCommentSections } from "./wordCommentMap";
import type { WordCommentPosition } from "./wordCommentPositions";
import type {
  WordCommentDateUtc,
  WordCommentEntryRecord,
  WordCommentThreadRecord,
} from "./wordCommentReader";
import type { WordCommentCaptureRefs } from "./wordCommentRefs";
import type { WordHostPlatform } from "./wordHostPlatform";
import type {
  WordCommentCoverage,
  WordCommentEntry,
  WordCommentEnvelope,
  WordCommentMapRow,
  WordCommentScope,
  WordCommentSelection,
  WordCommentThread,
  WordCommentWhere,
  WordCommentWhy,
} from "@erato/frontend/word-review";

/**
 * The comment context the model reads (contract §6–§7, Annex A §3.2): threads in document order
 * with their entries' hierarchy (n), chronology (at, age) and the host's hints (me, label,
 * likely_erato, same_author_as_root), inside one envelope whose coverage says what was sent,
 * listed, cut or left out. authorEmail never leaves the pane: it only derives `me` and
 * `same_author_as_root`. Comment text stays inside JSON values, so the untrusted frame
 * (ERMAIN-946) can wrap the whole argument.
 */

/** Labels Erato used before the configured one, so older comments are still recognised. */
export const WORD_COMMENT_PAST_LABELS: readonly string[] = [
  "Erato:",
  "Erato AI:",
];
/** The AI-author templates of O-28; the deployment may configure another. */
export const WORD_COMMENT_AI_AUTHOR_TEMPLATES: readonly string[] = [
  "Erato (AI) for {user}",
  "Erato (KI) für {user}",
];
/**
 * A clock without a zone this close to midnight may fall on another day for the user: the author
 * wrote it on their own wall clock, and co-authors are often a few zones apart.
 */
export const WORD_COMMENT_DAY_UNCERTAIN_HOURS = 3;

const encoder = new TextEncoder();
const utf8 = (text: string) => encoder.encode(text).length;

export interface WordCommentPeople {
  /** The signed-in Erato principal's email; `me` compares it with each entry's authorEmail. */
  principalEmail: string | null;
  /** The deployment's comment_label. */
  label?: string | null;
  /** The deployment's AI-author template, with {user}. */
  assistantAuthor?: string | null;
}

export interface WordCommentClock {
  now: Date;
  /** An IANA zone: the pane's own, which is also the zone desktop Word read w:date in (F-4). */
  userTz: string;
  host: WordHostPlatform;
  dateUtc: WordCommentDateUtc;
}

export interface WordCommentSource {
  ref: string;
  record: WordCommentThreadRecord;
  /** Null when no paragraph of the anchor is known: counted, never sent. */
  where: WordCommentWhere | null;
  pos: number;
  matchedByContent: boolean;
}

export interface WordCommentModelThread {
  /** Every entry, uncut; the envelope cuts what it sends. */
  thread: WordCommentThread;
  /** Replies Word listed; null when they were not read, as Word for Mac lists them slowly. */
  replies: number | null;
}

/** Every thread of the document, ready to send. */
export interface WordCommentModel {
  /** Threads with a known paragraph, in document order. */
  threads: WordCommentModelThread[];
  /** Threads Word listed without a paragraph the pane could place. */
  unplaced: { open: number; resolved: number };
  legacy: boolean;
}

export function wordCommentUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      formatter = formatterFor("UTC");
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock of a moment in a zone. */
function wallClock(date: Date, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  return {
    day,
    minutes: hour * 60 + minute,
    text: `${day}T${part("hour")}:${part("minute")}`,
  };
}

/** UTC with a Z, to the minute or the second. */
export function wordCommentUtcTime(date: Date, seconds = false): string {
  const iso = date.toISOString();
  return `${iso.slice(0, seconds ? 19 : 16)}Z`;
}

const minuteKey = (date: Date) => Math.floor(date.getTime() / 60_000);

const normalizedEmail = (email: string | null | undefined) =>
  email?.trim().toLowerCase() || null;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function templatePattern(template: string): RegExp | null {
  const [before, after, ...rest] = template.split("{user}");
  if (after === undefined || rest.length > 0) return null;
  return new RegExp(
    `^${escapeRegExp(before.trim())}\\s*.+?\\s*${escapeRegExp(after.trim())}$`,
    "iu",
  );
}

interface Recogniser {
  labelled: (text: string) => boolean;
  aiAuthor: (author: string) => boolean;
}

function recogniser(people: WordCommentPeople): Recogniser {
  const labels = [people.label ?? "", ...WORD_COMMENT_PAST_LABELS]
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
  const templates = [
    ...(people.assistantAuthor ? [people.assistantAuthor] : []),
    ...WORD_COMMENT_AI_AUTHOR_TEMPLATES,
  ]
    .map(templatePattern)
    .filter((pattern): pattern is RegExp => pattern !== null);
  return {
    labelled: (text) => {
      const start = text.trimStart().toLowerCase();
      return labels.some((label) => start.startsWith(label));
    },
    aiAuthor: (author) => {
      const name = author.trim();
      return (
        name.toLowerCase() === "erato" ||
        templates.some((pattern) => pattern.test(name))
      );
    },
  };
}

/** Plain text as Word gives it: "\r" line ends as "\n", no other control characters. */
const plainText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");

interface Timing {
  at: string | null;
  tz?: "unknown";
  key: number | null;
  day: string | null;
  dayUncertain: boolean;
}

function timingOf(
  entry: WordCommentEntryRecord,
  clock: WordCommentClock,
): Timing {
  const date = entry.creationDate;
  if (!date) return { at: null, key: null, day: null, dayUncertain: false };
  const web = clock.host === "OfficeOnline";
  // Without dateUtc the web gives no date at all, so any web date is UTC.
  const utc =
    web || (clock.dateUtc.byId.get(entry.id) ?? clock.dateUtc.otherwise);
  const local = wallClock(date, clock.userTz);
  if (utc)
    return {
      at: wordCommentUtcTime(date, web),
      key: minuteKey(date),
      day: local.day,
      dayUncertain: false,
    };
  const margin = WORD_COMMENT_DAY_UNCERTAIN_HOURS * 60;
  return {
    at: local.text,
    tz: "unknown",
    key: minuteKey(date),
    day: local.day,
    dayUncertain: local.minutes < margin || local.minutes >= 24 * 60 - margin,
  };
}

/** The threads of one read with their refs and positions, in the read's document order. */
export function wordCommentSources(
  threads: readonly WordCommentThreadRecord[],
  refs: WordCommentCaptureRefs,
  positions: ReadonlyMap<string, WordCommentPosition>,
): WordCommentSource[] {
  return threads.map((record, i) => {
    const entry = refs.threads[i];
    if (!entry || entry.commentId !== record.id)
      throw new Error("The comment refs are not the refs of this read");
    const position = positions.get(entry.ref);
    return {
      ref: entry.ref,
      record,
      where: position ? wordCommentWhere(record, position) : null,
      pos: position?.pos ?? Number.MAX_SAFE_INTEGER,
      matchedByContent: entry.matchedBy === "content",
    };
  });
}

/**
 * Entries with their hints and times for every thread. `age` ranks minutes over every timed entry
 * of the document, the threads not sent included, so `tie` means the same minute on every host.
 */
export function buildWordCommentModel(input: {
  sources: readonly WordCommentSource[];
  clock: WordCommentClock;
  people: WordCommentPeople;
  legacy: boolean | null;
}): WordCommentModel {
  const { sources, clock, people } = input;
  const recognise = recogniser(people);
  const principal = normalizedEmail(people.principalEmail);
  const timings = sources.map(({ record }) =>
    [record, ...(record.replies ?? [])].map((entry) => timingOf(entry, clock)),
  );
  const keys = timings.flat().flatMap((t) => (t.key === null ? [] : [t.key]));
  const counts = new Map<number, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const ranks = new Map(
    [...counts.keys()].sort((a, b) => a - b).map((key, i) => [key, i + 1]),
  );

  const unplaced = { open: 0, resolved: 0 };
  const threads: (WordCommentModelThread & { pos: number; i: number })[] = [];
  sources.forEach((source, i) => {
    const { record, where } = source;
    if (!where) {
      unplaced[record.resolved ? "resolved" : "open"] += 1;
      return;
    }
    const root = record;
    const rootEmail = normalizedEmail(root.authorEmail);
    const entries = [root, ...(record.replies ?? [])].map(
      (entry, n): WordCommentEntry => {
        const time = timings[i][n];
        const email = normalizedEmail(entry.authorEmail);
        const text = plainText(entry.content);
        const label = recognise.labelled(text);
        const tied = time.key !== null && (counts.get(time.key) ?? 0) > 1;
        return {
          n,
          by: entry.authorName,
          ...(principal && email === principal ? { me: true as const } : {}),
          ...(label ? { label: true as const } : {}),
          ...(label || recognise.aiAuthor(entry.authorName)
            ? { likely_erato: true as const }
            : {}),
          at: time.at,
          ...(time.tz ? { tz: time.tz } : {}),
          age: time.key === null ? null : ranks.get(time.key)!,
          ...(tied ? { tie: true as const } : {}),
          day: time.day,
          ...(time.dayUncertain ? { day_uncertain: true as const } : {}),
          ...(n > 0 &&
          entry.authorName === root.authorName &&
          email === rootEmail
            ? { same_author_as_root: true as const }
            : {}),
          text,
        };
      },
    );
    const timed = timings[i]
      .map((time, n) => ({ time, n }))
      .filter(({ time }) => time.key !== null)
      .sort((a, b) => a.time.key! - b.time.key! || a.n - b.n);
    threads.push({
      pos: source.pos,
      i,
      replies: record.replies?.length ?? null,
      thread: {
        id: source.ref,
        pos: source.pos,
        status: record.resolved ? "resolved" : "open",
        where,
        first_at: timed[0]?.time.at ?? null,
        last_at: timed[timed.length - 1]?.time.at ?? null,
        entries,
        ...(record.readOnly ? { read_only: true as const } : {}),
        ...(source.matchedByContent
          ? { matched_by_content: true as const }
          : {}),
      },
    });
  });
  threads.sort((a, b) => a.pos - b.pos || a.i - b.i);
  return {
    threads: threads.map(({ thread, replies }) => ({ thread, replies })),
    unplaced,
    legacy: input.legacy === true,
  };
}

function cutText(text: string): { text: string; cut: boolean } {
  if (text.length <= WORD_COMMENT_TEXT_MAX_CHARS) return { text, cut: false };
  let end = WORD_COMMENT_TEXT_MAX_CHARS - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: `${text.slice(0, end)}…`, cut: true };
}

interface Trimmed {
  thread: WordCommentThread;
  texts: number;
  replies: number;
}

/** Long texts cut at 1,200 characters; past 8 replies, the ones after the comment are counted. */
function trimmed(
  thread: WordCommentThread,
  sent: ReadonlySet<string>,
): Trimmed {
  const [root, ...replies] = thread.entries;
  const kept = replies.slice(-WORD_COMMENT_KEPT_REPLIES);
  const omitted = replies.length - kept.length;
  let texts = 0;
  const entries = [root, ...kept].map((entry) => {
    const { text, cut } = cutText(entry.text);
    if (!cut) return entry;
    texts += 1;
    return { ...entry, text, cut: true as const };
  });
  const overlaps = thread.where.overlaps?.filter((ref) => sent.has(ref));
  const { overlaps: _all, ...where } = thread.where;
  return {
    thread: {
      ...thread,
      where: overlaps?.length ? { ...where, overlaps } : where,
      entries,
      ...(omitted > 0 ? { omitted_replies: omitted } : {}),
    },
    texts,
    replies: omitted,
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** What was sent, listed and left out, with paragraph numbers only: no names, no text. */
function coverageLine(
  coverage: Omit<WordCommentCoverage, "line">,
  unplaced: number,
  nearest: { above: number | null; below: number | null } | null,
): string {
  const parts = [
    `${plural(coverage.threads_total, "comment thread")} in the document (${coverage.open} open, ${coverage.resolved} resolved): ${coverage.sent_full} sent with their text, ${coverage.sent_index_only} listed without text, ${coverage.not_shown} not shown.`,
  ];
  if (unplaced > 0)
    parts.push(`${plural(unplaced, "thread")} with no known paragraph.`);
  if (coverage.cut.texts > 0 || coverage.cut.replies > 0)
    parts.push(
      `Cut: ${plural(coverage.cut.texts, "text")} over ${WORD_COMMENT_TEXT_MAX_CHARS} characters, ${plural(coverage.cut.replies, "reply", "replies")} before the last ${WORD_COMMENT_KEPT_REPLIES} of a thread.`,
    );
  if (nearest)
    parts.push(
      `Nearest commented paragraph above the selection: ${nearest.above ?? "none"}; below: ${nearest.below ?? "none"}.`,
    );
  return parts.join(" ");
}

function nearestOf(threads: readonly WordCommentModelThread[]) {
  let above: number | null = null;
  let below: number | null = null;
  for (const { thread } of threads) {
    const { vs, para, through } = thread.where;
    if (vs === "before") above = Math.max(above ?? 0, through ?? para);
    if (vs === "after") below = Math.min(below ?? Infinity, para);
  }
  return { above, below };
}

export interface WordCommentEnvelopeInput {
  scope: WordCommentScope;
  model: WordCommentModel;
  now: Date;
  userTz: string;
  /** Refs sent with their text, most important first. */
  full: readonly string[];
  /** Refs listed without text, most important first. */
  listed?: readonly string[];
  /** Of `full`, the threads that keep their text up to the cap; the others give way at the target. */
  essential?: readonly string[];
  selection?: WordCommentSelection;
  sections?: WordCommentSections;
  why?: WordCommentWhy;
  cursor?: string;
  targetBytes?: number;
  maxBytes?: number;
}

export interface WordCommentEnvelopeBuild {
  envelope: WordCommentEnvelope;
  json: string;
  bytes: number;
  /** Refs sent with their text and refs listed, in document order. */
  full: string[];
  listed: string[];
}

/**
 * One envelope: the full threads and listed rows in document order, under the target if threads
 * that are not essential can give way (to rows, then rows go), and never over the cap. Nothing is
 * dropped by age, and coverage counts whatever is left out.
 */
export function buildWordCommentEnvelope(
  input: WordCommentEnvelopeInput,
): WordCommentEnvelopeBuild {
  const { model } = input;
  const target = input.targetBytes ?? WORD_COMMENT_ARG_TARGET_BYTES;
  const max = input.maxBytes ?? WORD_COMMENT_ARG_MAX_BYTES;
  const byRef = new Map(model.threads.map((t) => [t.thread.id, t]));
  const known = (refs: readonly string[] | undefined) => [
    ...new Set((refs ?? []).filter((ref) => byRef.has(ref))),
  ];
  let full = known(input.full);
  let listed = known(input.listed).filter((ref) => !full.includes(ref));
  const essential = new Set(known(input.essential));
  const rows = new Map<string, WordCommentMapRow>();
  const rowOf = (ref: string) => {
    let row = rows.get(ref);
    if (!row) {
      const thread = byRef.get(ref)!;
      row = wordCommentMapRow(
        thread,
        input.sections?.(thread.thread.where.para),
      );
      rows.set(ref, row);
    }
    return row;
  };
  const order = new Map(model.threads.map((t, i) => [t.thread.id, i]));
  const inOrder = (refs: readonly string[]) =>
    [...refs].sort((a, b) => order.get(a)! - order.get(b)!);
  const totals = {
    open:
      model.threads.filter((t) => t.thread.status === "open").length +
      model.unplaced.open,
    resolved:
      model.threads.filter((t) => t.thread.status === "resolved").length +
      model.unplaced.resolved,
  };
  const unplaced = model.unplaced.open + model.unplaced.resolved;

  const build = (): WordCommentEnvelopeBuild => {
    const sent = new Set([...full, ...listed]);
    const kept = inOrder(full).map((ref) =>
      trimmed(byRef.get(ref)!.thread, sent),
    );
    const index = inOrder(listed).map(rowOf);
    const threadsTotal = totals.open + totals.resolved;
    const counts = {
      threads_total: threadsTotal,
      open: totals.open,
      resolved: totals.resolved,
      sent_full: kept.length,
      sent_index_only: index.length,
      not_shown: threadsTotal - kept.length - index.length,
      cut: {
        texts: kept.reduce((n, t) => n + t.texts, 0),
        replies: kept.reduce((n, t) => n + t.replies, 0),
      },
    };
    const complete =
      counts.not_shown === 0 &&
      counts.cut.texts === 0 &&
      counts.cut.replies === 0 &&
      !input.cursor;
    const coverage: WordCommentCoverage = {
      ...counts,
      complete,
      line: coverageLine(
        { ...counts, complete },
        unplaced,
        input.selection ? nearestOf(model.threads) : null,
      ),
    };
    const envelope: WordCommentEnvelope = {
      v: WORD_COMMENT_CONTEXT_VERSION,
      scope: input.scope,
      now: wordCommentUtcTime(input.now),
      user_tz: input.userTz,
      ...(input.selection ? { selection: input.selection } : {}),
      coverage,
      threads: kept.map((t) => t.thread),
      index,
      ...(model.legacy ? { legacy: true as const } : {}),
      ...(input.why ? { why: input.why } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    };
    const json = JSON.stringify(envelope);
    return {
      envelope,
      json,
      bytes: utf8(json),
      full: inOrder(full),
      listed: inOrder(listed),
    };
  };

  const everyRef = new Set(model.threads.map((t) => t.thread.id));
  const threadBytes = new Map<string, number>();
  const sizeOfThread = (ref: string) => {
    let size = threadBytes.get(ref);
    if (size === undefined) {
      const { thread } = trimmed(byRef.get(ref)!.thread, everyRef);
      size = utf8(JSON.stringify(thread)) + 1;
      threadBytes.set(ref, size);
    }
    return size;
  };
  const sizeOfRow = (ref: string) => utf8(JSON.stringify(rowOf(ref))) + 1;
  /** Demotes the least important threads to rows, then drops rows, until the size fits. */
  const shrink = (limit: number, mayDemote: (ref: string) => boolean) => {
    let built = build();
    while (built.bytes > limit) {
      let excess = built.bytes - limit;
      let changed = false;
      for (const ref of [...full].reverse()) {
        if (excess <= 0) break;
        if (!mayDemote(ref)) continue;
        full = full.filter((r) => r !== ref);
        listed = [ref, ...listed];
        excess -= sizeOfThread(ref) - sizeOfRow(ref);
        changed = true;
      }
      while (excess > 0 && listed.length > 0) {
        excess -= sizeOfRow(listed[listed.length - 1]);
        listed = listed.slice(0, -1);
        changed = true;
      }
      if (!changed) break;
      built = build();
    }
    return built;
  };
  const atTarget = shrink(target, (ref) => !essential.has(ref));
  return atTarget.bytes <= max ? atTarget : shrink(max, () => true);
}
