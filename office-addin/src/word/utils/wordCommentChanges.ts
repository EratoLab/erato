import {
  WORD_COMMENT_OP_ACTION,
  WORD_COMMENT_OPS,
  WORD_COMMENT_TEXT_MAX,
  isWordCommentEntryRef,
} from "@erato/frontend/word-review";

import { normalizeParagraphText } from "./buildWordDocumentArgs";
import { WORD_COMMENT_PAST_LABELS } from "./wordCommentEnvelope";
import { wordParagraphViewFromText } from "./wordCommentPackage";
import { resolveWordCommentRef } from "./wordCommentRefs";
import { wordParagraphAnchor } from "./wordParagraphResolver";
import { WORD_SELECTION_MAX_PARAGRAPHS } from "./wordSelectionAnchor";
import { wordSearchable } from "./wordSelectionRange";

import type {
  WordCommentEntryFingerprint,
  WordCommentRefEntry,
} from "./wordCommentRefs";
import type { WordHostPlatform } from "./wordHostPlatform";
import type {
  WordParagraphAnchor,
  WordParagraphEntry,
} from "./wordParagraphResolver";
import type { WordSelectionSnapshot } from "./wordSelectionAnchor";
import type {
  WordCapturedParagraph,
  WordCommentAction,
  WordCommentAuthorMode,
  WordCommentOp,
  WordCommentRepairableError,
} from "@erato/frontend/word-review";

/**
 * word_submit_comment_changes validation (contract §9.2–§9.5, Annex B §3): the model's changes
 * become draft rows only when every ref names a thread the model was given, every quote is found
 * exactly where it says, and every text is plain. Errors are the model's to repair; the card is
 * built from the draft alone.
 */

/** Word's search takes no more (PF5); a longer part needs desktop's prefix points. */
const SEARCH_MAX = 255;
const EXCERPT_CONTEXT = 40;
const ELLIPSIS = "…";
/** C0 and C1 controls other than tab and line feed, and Word's own item marks. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

export interface WordCommentValidationError {
  path: string;
  code: WordCommentRepairableError;
  message: string;
}

/** Visible text around the anchor, as the card shows it. */
export interface WordCommentExcerpt {
  before: string;
  text: string;
  after: string;
}

/** Where a new comment goes: paragraphs proven again at execute, and offsets in paragraph.text. */
export interface WordCommentAddTarget {
  kind: "selection" | "quote" | "paragraph";
  anchor: WordParagraphAnchor;
  /** paragraph.text of each covered paragraph at validation; execute requires it unchanged. */
  rangeTexts: readonly string[];
  /** In rangeTexts[0]. */
  start: number;
  /** In the last rangeText, exclusive. */
  end: number;
  /** Review ordinals; null when the capture gave none. */
  para: number | null;
  through: number | null;
  inTable: boolean;
  excerpt: WordCommentExcerpt;
}

export interface WordCommentDraftEntry {
  /** 0 is the thread's comment. */
  n: number;
  fingerprint: WordCommentEntryFingerprint;
}

export interface WordCommentDraftRow {
  /** Index in the submission's changes. */
  i: number;
  op: WordCommentOp;
  /** The ref as submitted: "t7k" or "t7k.2". */
  ref?: string;
  thread?: WordCommentRefEntry;
  /** edit and delete: the item they change; delete of n 0 is the whole thread. */
  entry?: WordCommentDraftEntry;
  add?: WordCommentAddTarget;
  /** The model's text, trimmed; never with a label. */
  text?: string;
  /** What Word receives under the user's name: the label prepended where O-8 asks for it. */
  finalText?: string;
  labelled: boolean;
  /** The row before it on the same thread that must apply first (O-6, O-23). */
  dependsOn?: number;
}

export interface WordCommentDraft {
  draftId: string;
  action: WordCommentAction;
  identity: string;
  host: WordHostPlatform;
  rows: WordCommentDraftRow[];
  label: string;
  /** What the user's setting asked for; per-row availability is decided on the card (O-28). */
  authorMode: WordCommentAuthorMode;
  /** A thread was named by content, as in a legacy file (O-17). */
  matchedByContent: boolean;
  /** The file has no stable comment ids (F-2a): no Comment.id is kept beyond this session (O-16). */
  legacy: boolean;
}

/** A body read at validation, for adds that name paragraphs. */
export interface WordCommentStoryFacts {
  entries: readonly WordParagraphEntry[];
  rangeTexts: readonly string[];
  /** Paragraph.tableNestingLevel. */
  nesting: readonly number[];
}

export interface WordCommentValidationContext {
  draftId: string;
  identity: string;
  host: WordHostPlatform;
  threads: ReadonlyMap<string, WordCommentRefEntry>;
  selection: WordSelectionSnapshot | null;
  /** The Send capture's paragraphs, by review ordinal; empty when the document was not read. */
  captured: ReadonlyMap<number, WordCapturedParagraph>;
  /** Null when no add names a paragraph. */
  story: WordCommentStoryFacts | null;
  label: string;
  authorMode: WordCommentAuthorMode;
  rowCap: (action: WordCommentAction) => number;
  /** What the request's comment reads found; unknown counts as legacy. */
  legacy: boolean | null;
}

type Change = Record<string, unknown> & { op: WordCommentOp };

export type WordCommentParse =
  | { ok: true; action: WordCommentAction; changes: Change[] }
  | { ok: false; errors: WordCommentValidationError[] };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const given = (value: unknown) => value !== undefined && value !== null;
const isOrdinal = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

const FIELDS: Readonly<Record<WordCommentOp, readonly string[]>> = {
  add: ["anchor", "text"],
  reply: ["thread", "text"],
  resolve: ["thread"],
  reopen: ["thread"],
  edit: ["target", "text"],
  delete: ["target"],
};
const OPTIONAL_FIELDS = ["anchor", "thread", "target", "text"];

const error = (
  path: string,
  code: WordCommentRepairableError,
  message: string,
): WordCommentValidationError => ({ path, code, message });

/** Shape, op fields and one action class; refs and quotes are checked against the document next. */
export function parseWordCommentChanges(
  input: unknown,
  rowCap: (action: WordCommentAction) => number,
): WordCommentParse {
  if (!object(input) || !Array.isArray(input.changes))
    return {
      ok: false,
      errors: [
        error(
          "/changes",
          "invalid-change",
          "Expected an object with a non-empty changes array.",
        ),
      ],
    };
  const extra = Object.keys(input).find((key) => key !== "changes");
  if (extra)
    return {
      ok: false,
      errors: [
        error(`/${extra}`, "invalid-change", "Only changes is accepted."),
      ],
    };
  const errors: WordCommentValidationError[] = [];
  const changes: Change[] = [];
  input.changes.forEach((change: unknown, i) => {
    const path = `/changes/${i}`;
    if (!object(change) || !WORD_COMMENT_OPS.includes(change.op as never)) {
      errors.push(
        error(
          `${path}/op`,
          "invalid-change",
          `op must be one of ${WORD_COMMENT_OPS.join(", ")}.`,
        ),
      );
      return;
    }
    const op = change.op as WordCommentOp;
    const wanted = FIELDS[op];
    for (const key of Object.keys(change)) {
      if (key === "op") continue;
      if (!OPTIONAL_FIELDS.includes(key))
        errors.push(
          error(`${path}/${key}`, "invalid-change", "Unknown field."),
        );
      else if (!wanted.includes(key) && given(change[key]))
        errors.push(
          error(
            `${path}/${key}`,
            "invalid-change",
            `${op} takes only ${wanted.join(" and ")}; leave ${key} null.`,
          ),
        );
    }
    for (const key of wanted)
      if (!given(change[key]))
        errors.push(
          error(`${path}/${key}`, "invalid-change", `${op} needs ${key}.`),
        );
    changes.push(change as Change);
  });
  if (errors.length) return { ok: false, errors };
  if (changes.length === 0)
    return {
      ok: false,
      errors: [
        error("/changes", "invalid-change", "Submit at least one change."),
      ],
    };
  const actions = new Set(changes.map(({ op }) => WORD_COMMENT_OP_ACTION[op]));
  if (actions.size > 1)
    return {
      ok: false,
      errors: [
        error(
          "/changes",
          "mixed-action-classes",
          "One submission holds one kind of change: adds only; or replies, resolves and reopens; or edits and deletes. Submit the others after the user has answered this card.",
        ),
      ],
    };
  const action = [...actions][0];
  const cap = rowCap(action);
  if (changes.length > cap)
    return {
      ok: false,
      errors: [
        error(
          "/changes",
          "too-many-rows",
          `At most ${cap} changes of this kind fit one card; submit the most important ${cap}.`,
        ),
      ],
    };
  return { ok: true, action, changes };
}

/** The label a text starts with, configured or used by Erato before; case and spacing ignored. */
export function wordCommentLabelPrefix(
  text: string,
  label: string,
): string | null {
  const start = text.trimStart();
  const lower = start.toLowerCase();
  for (const known of [label, ...WORD_COMMENT_PAST_LABELS]) {
    const trimmed = known.trim();
    if (trimmed && lower.startsWith(trimmed.toLowerCase()))
      return start.slice(0, trimmed.length);
  }
  return null;
}

export const withWordCommentLabel = (label: string, text: string) =>
  label.trim() ? `${label.trim()} ${text}` : text;

function textError(
  path: string,
  value: unknown,
  label: string,
): WordCommentValidationError | null {
  if (typeof value !== "string")
    return error(path, "invalid-change", "text must be a string.");
  const text = value.trim();
  if (!text)
    return error(
      path,
      "empty-text",
      "The text is empty; write the comment itself.",
    );
  if (text.length > WORD_COMMENT_TEXT_MAX)
    return error(
      path,
      "invalid-text",
      `The text has ${text.length} characters; at most ${WORD_COMMENT_TEXT_MAX} fit a comment.`,
    );
  if (CONTROL.test(text))
    return error(
      path,
      "invalid-text",
      "Plain text only: remove control characters; line breaks are fine.",
    );
  if (wordCommentLabelPrefix(text, label))
    return error(
      path,
      "label-in-text",
      "Leave out the label: Erato adds it where Word shows the user as the author.",
    );
  return null;
}

/** Normalized text the model saw, with each character's offset in the visible text. */
function normalizedFrom(visible: string): { text: string; source: number[] } {
  const chars: string[] = [];
  const source: number[] = [];
  for (let i = 0; i < visible.length; ) {
    if (/[\r\n\u000B]/.test(visible[i])) {
      source.push(i);
      chars.push(" ");
      while (i < visible.length && /[\r\n\u000B]/.test(visible[i])) i += 1;
    } else {
      source.push(i);
      chars.push(visible[i]);
      i += 1;
    }
  }
  let from = 0;
  let to = chars.length;
  while (from < to && /\s/.test(chars[from])) from += 1;
  while (to > from && /\s/.test(chars[to - 1])) to -= 1;
  return {
    text: chars.slice(from, to).join(""),
    source: source.slice(from, to),
  };
}

/** Word's search finds the same non-overlapping hits (wordCommentAnchorText counts them alike). */
function occurrencesOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (
    let at = haystack.indexOf(needle);
    at >= 0 && needle;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push(at);
  return found;
}

interface ParagraphView {
  position: number;
  rangeText: string;
  normalized: string;
  /** normalized index → paragraph.text offset of that character. */
  rangeAt: (k: number) => number;
  nesting: number;
}

function paragraphView(
  story: WordCommentStoryFacts,
  position: number,
): ParagraphView | null {
  const rangeText = story.rangeTexts[position];
  const view = wordParagraphViewFromText({
    rangeText,
    identityText: story.entries[position].text,
    inCell: story.nesting[position] > 0,
  });
  if (!view) return null;
  const { text, source } = normalizedFrom(view.visibleText);
  const byVisible = new Map<number, number>();
  for (let i = 0; i < rangeText.length; i += 1)
    if (view.visibleAt[i + 1] === view.visibleAt[i] + 1)
      byVisible.set(view.visibleAt[i], i);
  return {
    position,
    rangeText,
    normalized: text,
    rangeAt: (k) => byVisible.get(source[k]) ?? -1,
    nesting: story.nesting[position],
  };
}

function excerptOf(
  view: ParagraphView,
  from: number,
  to: number,
): WordCommentExcerpt {
  const before = view.normalized.slice(
    Math.max(0, from - EXCERPT_CONTEXT),
    from,
  );
  const after = view.normalized.slice(to, to + EXCERPT_CONTEXT);
  return {
    before: from > EXCERPT_CONTEXT ? `${ELLIPSIS}${before}` : before,
    text: view.normalized.slice(from, to),
    after:
      to + EXCERPT_CONTEXT < view.normalized.length
        ? `${after}${ELLIPSIS}`
        : after,
  };
}

const sameText = (a: string, b: string) =>
  normalizeParagraphText(a) === normalizeParagraphText(b);

/** The live paragraph a review ordinal names now; refuses when it changed since it was read. */
function positionOf(
  ctx: WordCommentValidationContext,
  story: WordCommentStoryFacts,
  para: number,
  path: string,
): number | WordCommentValidationError {
  const captured = ctx.captured.get(para);
  const changed = error(
    path,
    "paragraph-changed",
    `Paragraph ${para} changed since it was read. Read it again, or tell the user the comment could not be placed.`,
  );
  if (captured) {
    if (captured.uniqueLocalId) {
      const at = story.entries.flatMap((entry, i) =>
        entry.id === captured.uniqueLocalId ? [i] : [],
      );
      if (at.length === 1)
        return sameText(story.entries[at[0]].text, captured.text)
          ? at[0]
          : changed;
    }
    const position = para - 1;
    return position < story.entries.length &&
      sameText(story.entries[position].text, captured.text)
      ? position
      : changed;
  }
  if (para > story.entries.length)
    return error(
      path,
      "position-unknown",
      `There is no paragraph ${para}; use a paragraph number you were given.`,
    );
  return para - 1;
}

interface Located {
  from: number;
  to: number;
}

function locateQuote(
  view: ParagraphView,
  quote: string,
  occurrence: number | null,
  path: string,
  para: number,
): Located | WordCommentValidationError {
  const needle = normalizeParagraphText(quote);
  const found = occurrencesOf(view.normalized, needle);
  if (found.length === 0)
    return error(
      `${path}/quote`,
      "quote-not-found",
      `The quote is not in paragraph ${para}. Quote its text exactly as you were given it.`,
    );
  if (occurrence === null && found.length > 1)
    return error(
      `${path}/occurrence`,
      "quote-ambiguous",
      `The quote occurs ${found.length} times in paragraph ${para}; add occurrence (1–${found.length}) or quote more words.`,
    );
  const index = (occurrence ?? 1) - 1;
  if (index >= found.length)
    return error(
      `${path}/occurrence`,
      "quote-not-found",
      `Paragraph ${para} has the quote ${found.length} time${found.length === 1 ? "" : "s"}, not ${occurrence}.`,
    );
  return { from: found[index], to: found[index] + needle.length };
}

function rangeOffsets(
  view: ParagraphView,
  located: Located,
): { start: number; end: number } | null {
  const start = view.rangeAt(located.from);
  const last = view.rangeAt(located.to - 1);
  return start < 0 || last < start ? null : { start, end: last + 1 };
}

const positionUnknown = (path: string, para: number) =>
  error(
    path,
    "position-unknown",
    `Word cannot place a quote in paragraph ${para} (it holds tracked or hidden text, or the quote is too long for Word's search). Comment on the whole paragraph instead: anchor {"para": ${para}}.`,
  );

/** A part Word's search can prove: on the web nothing else is used (Annex B §2.3). */
function provable(
  ctx: WordCommentValidationContext,
  rangeText: string,
  start: number,
  end: number,
): boolean {
  if (start === 0 && end === rangeText.length) return true;
  if (ctx.host !== "OfficeOnline") return true;
  return wordSearchable(rangeText.slice(start, end), SEARCH_MAX);
}

/** The longest searchable piece at one edge of [start, end), for the multi-paragraph proof. */
export function wordCommentEdgePiece(
  rangeText: string,
  start: number,
  end: number,
  side: "start" | "end",
): { start: number; end: number } | null {
  if (side === "start") {
    if (start === 0) return { start, end: start };
    let to = start;
    while (
      to < end &&
      to - start < SEARCH_MAX &&
      !/[\^\u0000-\u001F]/.test(rangeText[to])
    )
      to += 1;
    return /\S/.test(rangeText.slice(start, to)) ? { start, end: to } : null;
  }
  if (end === rangeText.length) return { start: end, end };
  let from = end;
  while (
    from > start &&
    end - from < SEARCH_MAX &&
    !/[\^\u0000-\u001F]/.test(rangeText[from - 1])
  )
    from -= 1;
  return /\S/.test(rangeText.slice(from, end)) ? { start: from, end } : null;
}

function addTarget(
  ctx: WordCommentValidationContext,
  anchor: unknown,
  path: string,
): WordCommentAddTarget | WordCommentValidationError {
  if (anchor === "selection" || (object(anchor) && anchor.selection === true)) {
    if (
      object(anchor) &&
      ["para", "through", "quote", "occurrence"].some((k) => given(anchor[k]))
    )
      return error(
        path,
        "invalid-change",
        "A selection anchor takes no paragraph or quote.",
      );
    return selectionTarget(ctx, path);
  }
  if (!object(anchor) || !isOrdinal(anchor.para))
    return error(
      path,
      "invalid-change",
      'anchor is "selection", or {"para": n} with an optional quote, occurrence and through.',
    );
  const para = anchor.para;
  const through = given(anchor.through) ? anchor.through : null;
  const quote = given(anchor.quote) ? anchor.quote : null;
  const occurrence = given(anchor.occurrence) ? anchor.occurrence : null;
  if (through !== null && (!isOrdinal(through) || through < para))
    return error(
      `${path}/through`,
      "invalid-change",
      "through is a paragraph number after para.",
    );
  if (quote !== null && (typeof quote !== "string" || !quote.trim()))
    return error(`${path}/quote`, "invalid-change", "quote must be text.");
  if (occurrence !== null && !isOrdinal(occurrence))
    return error(
      `${path}/occurrence`,
      "invalid-change",
      "occurrence counts from 1.",
    );
  if (quote === null && occurrence !== null)
    return error(
      `${path}/occurrence`,
      "invalid-change",
      "occurrence needs a quote.",
    );
  const story = ctx.story;
  if (!story) return positionUnknown(path, para);
  // Without a quote only a paragraph the document read captured can be checked to be the one meant.
  if (
    quote === null &&
    (!ctx.captured.has(para) ||
      (through !== null && !ctx.captured.has(through)))
  )
    return error(
      path,
      "position-unknown",
      `Paragraph ${para} was not read with this request, so a comment on the whole paragraph cannot be checked. Quote the passage the comment is about.`,
    );
  const first = positionOf(ctx, story, para, `${path}/para`);
  if (typeof first !== "number") return first;
  let last = first;
  if (through !== null && through !== para) {
    const at = positionOf(ctx, story, through, `${path}/through`);
    if (typeof at !== "number") return at;
    if (at <= first || at - first + 1 > WORD_SELECTION_MAX_PARAGRAPHS)
      return error(
        `${path}/through`,
        "unsupported-anchor",
        `A comment may span at most ${WORD_SELECTION_MAX_PARAGRAPHS} paragraphs in order.`,
      );
    last = at;
  }
  const views: ParagraphView[] = [];
  for (let position = first; position <= last; position += 1) {
    const view = paragraphView(story, position);
    if (!view && (position === first || position === last))
      return positionUnknown(path, position + 1);
    if (view) views.push(view);
  }
  const multi = last > first;
  if (
    multi &&
    story.nesting.slice(first, last + 1).some((nesting) => nesting > 0)
  )
    return error(
      path,
      "unsupported-anchor",
      "A comment in a table stays inside one cell: anchor it on one paragraph of the cell.",
    );
  const firstView = views[0];
  const lastView = views[views.length - 1];
  let start = 0;
  let end = lastView.rangeText.length;
  let excerpt: WordCommentExcerpt;
  if (quote === null) {
    if (!firstView.normalized && !multi)
      return error(
        path,
        "unsupported-anchor",
        `Paragraph ${para} is empty; anchor the comment on a paragraph with text.`,
      );
    excerpt = {
      before: "",
      text: multi
        ? `${firstView.normalized.slice(0, EXCERPT_CONTEXT)}${ELLIPSIS}${lastView.normalized.slice(-EXCERPT_CONTEXT)}`
        : firstView.normalized,
      after: "",
    };
  } else if (multi) {
    const parts = quote.split(ELLIPSIS);
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim())
      return error(
        `${path}/quote`,
        "invalid-change",
        `Across paragraphs, quote the start of paragraph ${para}'s part and the end of paragraph ${through}'s, joined by "${ELLIPSIS}".`,
      );
    const head = locateQuote(firstView, parts[0], occurrence, path, para);
    if ("code" in head) return head;
    const tailFound = occurrencesOf(
      lastView.normalized,
      normalizeParagraphText(parts[1]),
    );
    if (tailFound.length !== 1)
      return tailFound.length
        ? error(
            `${path}/quote`,
            "quote-ambiguous",
            `The end of the quote occurs ${tailFound.length} times in paragraph ${through}; quote more of it.`,
          )
        : error(
            `${path}/quote`,
            "quote-not-found",
            `The end of the quote is not in paragraph ${through}.`,
          );
    const tail = {
      from: tailFound[0],
      to: tailFound[0] + normalizeParagraphText(parts[1]).length,
    };
    const headRange = rangeOffsets(firstView, head);
    const tailRange = rangeOffsets(lastView, tail);
    if (!headRange || !tailRange) return positionUnknown(path, para);
    start = headRange.start;
    end = tailRange.end;
    excerpt = {
      before: excerptOf(firstView, head.from, head.to).before,
      text: `${firstView.normalized.slice(head.from, head.from + EXCERPT_CONTEXT)}${ELLIPSIS}${lastView.normalized.slice(Math.max(tail.from, tail.to - EXCERPT_CONTEXT), tail.to)}`,
      after: excerptOf(lastView, tail.from, tail.to).after,
    };
  } else {
    const located = locateQuote(firstView, quote, occurrence, path, para);
    if ("code" in located) return located;
    const offsets = rangeOffsets(firstView, located);
    if (!offsets) return positionUnknown(path, para);
    ({ start, end } = offsets);
    excerpt = excerptOf(firstView, located.from, located.to);
  }
  if (multi) {
    if (
      !wordCommentEdgePiece(
        firstView.rangeText,
        start,
        firstView.rangeText.length,
        "start",
      ) ||
      !wordCommentEdgePiece(lastView.rangeText, 0, end, "end")
    )
      return positionUnknown(path, para);
  } else if (!provable(ctx, firstView.rangeText, start, end))
    return positionUnknown(path, para);
  return {
    kind: quote === null ? "paragraph" : "quote",
    anchor: wordParagraphAnchor(story.entries, first, last),
    rangeTexts: story.rangeTexts.slice(first, last + 1),
    start,
    end,
    para,
    through: multi ? (through ?? null) : null,
    inTable: firstView.nesting > 0,
    excerpt,
  };
}

/**
 * Commentable is not v2's rewrite role: a link, a field or tracked text does not stop a comment.
 * Only where the passage is, and whether Word can find it again, do (Annex B §3.a).
 */
export function wordSelectionCommentable(
  selection: WordSelectionSnapshot | null,
): WordSelectionSnapshot | null {
  if (!selection || selection.story !== "main" || !selection.anchor)
    return null;
  if (selection.shape === "table") return null;
  if (
    selection.reasonCode &&
    [
      "host_unsupported",
      "other_story",
      "whole_table",
      "multi_cell",
      "nested_table",
      "cell_multi_paragraph",
      "too_many_paragraphs",
      "position_unknown",
      "not_unique",
    ].includes(selection.reasonCode)
  )
    return null;
  const { paragraphs, startOffset, endOffset } = selection;
  if (paragraphs.length === 0) return null;
  if (paragraphs.length === 1 && startOffset >= endOffset) return null;
  return selection;
}

function selectionTarget(
  ctx: WordCommentValidationContext,
  path: string,
): WordCommentAddTarget | WordCommentValidationError {
  const selection = wordSelectionCommentable(ctx.selection);
  if (!selection)
    return error(
      path,
      "selection-unavailable",
      "No passage that can take a comment was selected with this request. Anchor the comment on a quote in a paragraph instead, or ask the user to select the passage.",
    );
  const rangeTexts = selection.paragraphs.map((p) => p.rangeText);
  const first = rangeTexts[0];
  const last = rangeTexts[rangeTexts.length - 1];
  const { startOffset: start, endOffset: end } = selection;
  const multi = rangeTexts.length > 1;
  if (
    multi
      ? !wordCommentEdgePiece(first, start, first.length, "start") ||
        !wordCommentEdgePiece(last, 0, end, "end")
      : !provable(ctx, first, start, end)
  )
    return error(
      path,
      "selection-unavailable",
      "Word cannot find this selection again exactly. Anchor the comment on a quote in a paragraph instead.",
    );
  const index = selection.paragraphs[0].index;
  const lines = selection.selectedText.split("\n");
  return {
    kind: "selection",
    anchor: selection.anchor!,
    rangeTexts,
    start,
    end,
    para: index + 1,
    through: multi
      ? selection.paragraphs[selection.paragraphs.length - 1].index + 1
      : null,
    inTable: selection.shape === "table_cell",
    excerpt: {
      before: "",
      text: multi
        ? `${lines[0].slice(0, EXCERPT_CONTEXT)}${ELLIPSIS}${lines[lines.length - 1].slice(-EXCERPT_CONTEXT)}`
        : selection.selectedText,
      after: "",
    },
  };
}

interface Resolved {
  thread: WordCommentRefEntry;
  entry?: WordCommentDraftEntry;
}

function threadOf(
  ctx: WordCommentValidationContext,
  value: unknown,
  path: string,
  forThread: boolean,
): Resolved | WordCommentValidationError {
  const refs = { threads: [], byRef: ctx.threads };
  if (forThread && isWordCommentEntryRef(value))
    return error(
      path,
      "reply-ref-for-reply",
      `Word replies, resolves and reopens whole threads: use ${String(value).split(".")[0]}, not ${String(value)}.`,
    );
  const resolved = resolveWordCommentRef(refs, value);
  if (!resolved.ok)
    return error(
      path,
      "unknown-ref",
      `${typeof value === "string" ? value : "This value"} names no comment thread you were given. Use a ref such as t7k, or t7k.2 for a reply.`,
    );
  const { entry: thread, target } = resolved;
  if (thread.readOnly)
    return error(
      path,
      "thread-read-only",
      "Word lists this thread in a way no write could prove, so it can only be read. Tell the user to change it in Word.",
    );
  if (target.kind === "thread") return { thread };
  const fingerprint =
    target.n === 0
      ? thread.fingerprint
      : thread.fingerprint.replies![target.n - 1];
  return { thread, entry: { n: target.n, fingerprint } };
}

/** Validates parsed changes against the request's threads, selection and paragraphs. */
export function validateWordCommentChanges(
  parsed: Extract<WordCommentParse, { ok: true }>,
  ctx: WordCommentValidationContext,
):
  | { ok: true; draft: WordCommentDraft }
  | { ok: false; errors: WordCommentValidationError[] } {
  const errors: WordCommentValidationError[] = [];
  const rows: WordCommentDraftRow[] = [];
  /** Per thread commentId: the rows on it, in submission order. */
  const onThread = new Map<string, WordCommentDraftRow[]>();
  const targets = new Set<string>();
  parsed.changes.forEach((change, i) => {
    const path = `/changes/${i}`;
    const { op } = change;
    const withText = op === "add" || op === "reply" || op === "edit";
    if (withText) {
      const problem = textError(`${path}/text`, change.text, ctx.label);
      if (problem) {
        errors.push(problem);
        return;
      }
    }
    const text = withText ? (change.text as string).trim() : undefined;
    if (op === "add") {
      const add = addTarget(ctx, change.anchor, `${path}/anchor`);
      if ("code" in add) {
        errors.push(add);
        return;
      }
      rows.push({
        i,
        op,
        add,
        text,
        finalText: withWordCommentLabel(ctx.label, text!),
        labelled: !!ctx.label.trim(),
      });
      return;
    }
    const forThread = op !== "edit" && op !== "delete";
    const value = forThread ? change.thread : change.target;
    const resolved = threadOf(
      ctx,
      value,
      `${path}/${forThread ? "thread" : "target"}`,
      forThread,
    );
    if ("code" in resolved) {
      errors.push(resolved);
      return;
    }
    const { thread } = resolved;
    const entry =
      op === "edit"
        ? (resolved.entry ?? { n: 0, fingerprint: thread.fingerprint })
        : op === "delete"
          ? (resolved.entry ?? { n: 0, fingerprint: thread.fingerprint })
          : undefined;
    const needsReplies = forThread || (op === "delete" && entry!.n === 0);
    if (needsReplies && thread.fingerprint.replyIds === null) {
      errors.push(
        error(
          `${path}/${forThread ? "thread" : "target"}`,
          "thread-not-read",
          `The replies of ${thread.ref} were not read, so the change cannot be checked against them. Read the thread first with word_read_comments (near: {"ref": "${thread.ref}"}), then submit again.`,
        ),
      );
      return;
    }
    const key = `${thread.commentId}:${entry ? entry.n : "thread"}`;
    let finalText: string | undefined;
    let labelled = false;
    if (op === "reply") {
      finalText = withWordCommentLabel(ctx.label, text!);
      labelled = !!ctx.label.trim();
    } else if (op === "edit") {
      const prefix = wordCommentLabelPrefix(
        entry!.fingerprint.content,
        ctx.label,
      );
      finalText = prefix ? `${prefix} ${text}` : text;
      labelled = !!prefix;
    }
    const row: WordCommentDraftRow = {
      i,
      op,
      ref: String(value),
      thread,
      ...(entry ? { entry } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(finalText !== undefined ? { finalText } : {}),
      labelled,
    };
    if (op === "edit" || op === "delete") {
      if (targets.has(key)) {
        errors.push(
          error(
            path,
            "duplicate-target",
            `${row.ref} is already changed in this submission.`,
          ),
        );
        return;
      }
      targets.add(key);
    }
    rows.push(row);
    onThread.set(thread.commentId, [
      ...(onThread.get(thread.commentId) ?? []),
      row,
    ]);
  });

  for (const [, list] of onThread) {
    if (parsed.action === "word.modify_comments") {
      const whole = list.find(
        (row) => row.op === "delete" && row.entry?.n === 0,
      );
      if (whole && list.length > 1)
        errors.push(
          error(
            `/changes/${whole.i}`,
            "duplicate-target",
            `Deleting ${whole.thread!.ref} removes its replies too; leave the other changes to it out.`,
          ),
        );
      continue;
    }
    const ops = list.map((row) => row.op).join(",");
    const allowed = [
      "reply",
      "resolve",
      "reopen",
      "reopen,reply",
      "reply,resolve",
    ];
    if (!allowed.includes(ops)) {
      errors.push(
        error(
          `/changes/${list[1]?.i ?? list[0].i}`,
          "duplicate-target",
          `One thread takes one change, or reopen then reply, or reply then resolve; ${list[0].thread!.ref} has ${ops.replace(/,/g, " then ")}.`,
        ),
      );
      continue;
    }
    if (list.length === 2) list[1].dependsOn = list[0].i;
    const reply = list.find((row) => row.op === "reply");
    if (reply && reply.thread!.fingerprint.resolved && list[0].op !== "reopen")
      errors.push(
        error(
          `/changes/${reply.i}`,
          "reopen-first",
          `${reply.thread!.ref} is resolved: put {"op": "reopen", "thread": "${reply.thread!.ref}"} right before the reply.`,
        ),
      );
  }

  if (errors.length) return { ok: false, errors: errors.slice(0, 16) };
  return {
    ok: true,
    draft: {
      draftId: ctx.draftId,
      action: parsed.action,
      identity: ctx.identity,
      host: ctx.host,
      rows,
      label: ctx.label.trim(),
      authorMode: ctx.authorMode,
      matchedByContent: rows.some((row) => row.thread?.matchedBy === "content"),
      legacy: ctx.legacy !== false,
    },
  };
}
