import {
  WORD_COMMENT_ARG_TARGET_BYTES,
  WORD_COMMENT_CONTEXT_VERSION,
  WORD_COMMENT_GIST_CHARS,
  WORD_COMMENT_SECTION_SEPARATOR,
} from "@erato/frontend/word-review";

import { normalizeParagraphText } from "./buildWordDocumentArgs";

import type {
  WordCommentModel,
  WordCommentModelThread,
} from "./wordCommentEnvelope";
import type { WordCommentInventoryParagraph } from "./wordCommentReader";
import type {
  WordCommentEnvelope,
  WordCommentMapRow,
} from "@erato/frontend/word-review";

/**
 * The whole document's comment map (ERMAIN-948, owner direction 2026-10-12): one short row per
 * thread in document order, built at Send whenever the document is included, so the model knows
 * every thread's place, section, author, status and gist before it reads any in full. Rows are
 * plain data from the Office.js list, roots only where replies were not read: a later step can
 * store them once (ERMAIN-962) or paste them into a delegated brief (ERMAIN-954). The first page
 * is capped; word_read_comments continues from its cursor. Gists and quotes are other people's
 * text, so the map travels inside its JSON value like every comment payload.
 */

export const WORD_COMMENT_MAP_QUOTE_CHARS = 32;
export const WORD_COMMENT_MAP_AUTHOR_CHARS = 32;
export const WORD_COMMENT_MAP_HEADING_CHARS = 32;
export const WORD_COMMENT_MAP_SECTION_CHARS = 60;
export const WORD_COMMENT_MAP_PAGE_ROWS = 100;
const CURSOR = /^map:(0|[1-9]\d{0,6})$/;

const encoder = new TextEncoder();
const utf8 = (text: string) => encoder.encode(text).length;

export interface WordCommentHeading {
  ordinal: number;
  /** 1 to 9; Title counts as 1. */
  level: number;
  text: string;
}

/** The heading chain a paragraph is in, outermost first; undefined before the first heading. */
export type WordCommentSections = (para: number) => string | undefined;

/** At most `limit` characters, cut at a space when one is near, with an ellipsis. */
export function wordCommentGist(
  text: string,
  limit = WORD_COMMENT_GIST_CHARS,
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Headings from the capture's paragraphs or the reader's light inventory. */
export function wordCommentHeadingsFromInventory(
  paragraphs: readonly WordCommentInventoryParagraph[],
): WordCommentHeading[] {
  return paragraphs.flatMap((p) =>
    p.heading && p.text !== undefined
      ? [{ ordinal: p.ordinal, level: p.heading, text: p.text }]
      : [],
  );
}

/** Headings from WordDocumentBuild.headings. */
export function wordCommentHeadingsFromBuild(
  headings: ReadonlyMap<number, { level: number; text: string }>,
): WordCommentHeading[] {
  return [...headings].map(([ordinal, heading]) => ({ ordinal, ...heading }));
}

/** Keeps the innermost headings when the whole chain is too long. */
function chainText(chain: readonly string[]): string {
  const separator = WORD_COMMENT_SECTION_SEPARATOR;
  const parts = [...chain];
  let text = parts.join(separator);
  while (parts.length > 1 && text.length > WORD_COMMENT_MAP_SECTION_CHARS) {
    parts.shift();
    text = `…${separator}${parts.join(separator)}`;
  }
  return text.length > WORD_COMMENT_MAP_SECTION_CHARS
    ? wordCommentGist(text, WORD_COMMENT_MAP_SECTION_CHARS)
    : text;
}

export function wordCommentSections(
  headings: Iterable<WordCommentHeading>,
): WordCommentSections {
  const sorted = [...headings]
    .map((h) => ({
      ...h,
      text: wordCommentGist(
        normalizeParagraphText(h.text),
        WORD_COMMENT_MAP_HEADING_CHARS,
      ),
    }))
    .filter((h) => h.text !== "" && h.level >= 1)
    .sort((a, b) => a.ordinal - b.ordinal);
  const stack: WordCommentHeading[] = [];
  const chains = sorted.map((heading) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level)
      stack.pop();
    stack.push(heading);
    return chainText(stack.map((h) => h.text));
  });
  return (para) => {
    let low = 0;
    let high = sorted.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (sorted[mid].ordinal <= para) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    return found < 0 ? undefined : chains[found];
  };
}

/** One row: where, who, status, replies, latest time and a gist; about 150–250 bytes. */
export function wordCommentMapRow(
  model: WordCommentModelThread,
  section?: string,
): WordCommentMapRow {
  const { thread } = model;
  const [root] = thread.entries;
  const quote = wordCommentGist(
    thread.where.quote,
    WORD_COMMENT_MAP_QUOTE_CHARS,
  );
  const gist = wordCommentGist(root.text);
  return {
    id: thread.id,
    ...(section ? { sec: section } : {}),
    para: thread.where.para,
    ...(quote ? { q: quote } : {}),
    by: wordCommentGist(root.by, WORD_COMMENT_MAP_AUTHOR_CHARS),
    st: thread.status,
    r: model.replies,
    at: thread.last_at,
    ...(gist ? { g: gist } : {}),
  };
}

export const wordCommentMapCursor = (start: number) => `map:${start}`;

/** The row a map cursor continues from; null for anything else. */
export function parseWordCommentMapCursor(cursor: string): number | null {
  const match = CURSOR.exec(cursor);
  return match ? Number(match[1]) : null;
}

export interface WordCommentMap {
  /** One row per thread with a known paragraph, in document order. */
  rows: readonly WordCommentMapRow[];
  threadsTotal: number;
  open: number;
  resolved: number;
  /** Listed by Word with no paragraph the pane could place. */
  unplaced: number;
  now: string;
  userTz: string;
  legacy: boolean;
}

export interface WordCommentMapPageOptions {
  maxBytes?: number;
  maxRows?: number;
}

export function buildWordCommentMap(input: {
  model: WordCommentModel;
  now: Date;
  userTz: string;
  sections?: WordCommentSections;
}): WordCommentMap {
  const { model } = input;
  const rows = model.threads.map((thread) =>
    wordCommentMapRow(thread, input.sections?.(thread.thread.where.para)),
  );
  const count = (status: "open" | "resolved") =>
    model.threads.filter((t) => t.thread.status === status).length +
    model.unplaced[status];
  const open = count("open");
  const resolved = count("resolved");
  return {
    rows,
    threadsTotal: open + resolved,
    open,
    resolved,
    unplaced: model.unplaced.open + model.unplaced.resolved,
    now: `${input.now.toISOString().slice(0, 16)}Z`,
    userTz: input.userTz,
    legacy: model.legacy,
  };
}

function pageLine(
  map: WordCommentMap,
  start: number,
  shown: number,
  next: number | null,
): string {
  const notShown = map.threadsTotal - shown;
  const range = shown > 0 ? `rows ${start + 1}–${start + shown}` : "no rows";
  return [
    `Comment map: ${range} of ${map.rows.length}, for ${map.threadsTotal} comment threads in the document (${map.open} open, ${map.resolved} resolved); ${notShown} not shown.`,
    ...(map.unplaced > 0 ? [`${map.unplaced} with no known paragraph.`] : []),
    ...(next !== null
      ? [
          `More rows: word_read_comments with cursor ${wordCommentMapCursor(next)}.`,
        ]
      : []),
  ].join(" ");
}

/**
 * One page of the map from a row on, as the envelope the comment_map argument and
 * word_read_comments carry: rows only, capped by bytes and rows, with an honest not_shown count
 * and a cursor while rows remain. Null for a start past the last row.
 */
export function wordCommentMapPage(
  map: WordCommentMap,
  start = 0,
  options: WordCommentMapPageOptions = {},
): WordCommentEnvelope | null {
  if (!Number.isSafeInteger(start) || start < 0) return null;
  if (start > 0 && start >= map.rows.length) return null;
  const maxBytes = options.maxBytes ?? WORD_COMMENT_ARG_TARGET_BYTES;
  const maxRows = options.maxRows ?? WORD_COMMENT_MAP_PAGE_ROWS;
  const envelopeOf = (count: number): WordCommentEnvelope => {
    const end = start + count;
    const next = end < map.rows.length ? end : null;
    const notShown = map.threadsTotal - count;
    return {
      v: WORD_COMMENT_CONTEXT_VERSION,
      scope: "document",
      now: map.now,
      user_tz: map.userTz,
      coverage: {
        threads_total: map.threadsTotal,
        open: map.open,
        resolved: map.resolved,
        sent_full: 0,
        sent_index_only: count,
        not_shown: notShown,
        cut: { texts: 0, replies: 0 },
        complete: notShown === 0,
        line: pageLine(map, start, count, next),
      },
      threads: [],
      index: map.rows.slice(start, end),
      ...(map.legacy ? { legacy: true as const } : {}),
      ...(next !== null ? { cursor: wordCommentMapCursor(next) } : {}),
    };
  };
  let count = Math.min(maxRows, map.rows.length - start);
  const base = utf8(JSON.stringify(envelopeOf(0)));
  let used = base;
  for (let i = 0; i < count; i += 1) {
    used += utf8(JSON.stringify(map.rows[start + i])) + 1;
    if (used > maxBytes) {
      count = i;
      break;
    }
  }
  let page = envelopeOf(count);
  while (count > 0 && utf8(JSON.stringify(page)) > maxBytes)
    page = envelopeOf((count -= 1));
  return page;
}
