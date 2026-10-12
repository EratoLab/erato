import {
  WORD_ANCHORED_COMMENTS_ARG,
  WORD_COMMENT_MAP_ARG,
  WORD_COMMENT_THREAD_FACET_ID,
  WORD_COMMENTS_JSON_ARG,
  WORD_THREAD_JSON_ARG,
} from "@erato/frontend/word-review";

import {
  WORD_AUTHORING_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "./wordActionFacet";
import {
  buildWordCommentEnvelope,
  buildWordCommentModel,
  wordCommentSources,
} from "./wordCommentEnvelope";
import {
  buildWordCommentMap,
  wordCommentMapPage,
  wordCommentSections,
} from "./wordCommentMap";
import {
  wordCommentCaretCoordinates,
  wordCommentPositionInput,
  wordCommentPositions,
  wordCommentSelection,
} from "./wordCommentPositions";
import { issueWordCommentRefs } from "./wordCommentRefs";

import type {
  WordCommentModel,
  WordCommentPeople,
} from "./wordCommentEnvelope";
import type { WordCommentHeading } from "./wordCommentMap";
import type { WordCommentSelectionCoordinates } from "./wordCommentPositions";
import type {
  WordCommentLiveSelection,
  WordCommentReadResult,
  WordCommentThreadRecord,
} from "./wordCommentReader";
import type {
  WordCommentCaptureRefs,
  WordCommentRefRegistry,
} from "./wordCommentRefs";
import type {
  WordCommentVs,
  WordCommentWhy,
  WordDocumentCapture,
} from "@erato/frontend/word-review";

/**
 * Which comment context a Send carries (contract §7–§8, O-19, O-24), as a pure decision over what
 * Word showed at Send, the user's gestures and what config advertises. One facet per message:
 * - word_selection with anchored_comments: a passage, with its own threads and the coverage line;
 * - word_comment_thread with thread_json and comments_json: a picked thread, or the one at the
 *   caret, or a single-thread passage under "Work on the comment"; with an empty thread_json and the
 *   open threads when "Include open comments" is on and nothing is selected or picked (ERMAIN-951
 *   must word the facet for that);
 * - the document facets with comment_map: the whole document's map whenever the document goes.
 * Nothing here reads Word; the composer reads comments at every Send, and only when something is
 * advertised.
 */

/** The "Word behavior" setting: what a rewrite-eligible selection over one thread works on. */
export type WordCommentPrecedence = "selection" | "comment";
/** The chip's switch for one message, in either direction. */
export type WordCommentOverride = "comment" | "passage";
/** "Chosen by you", "At your cursor", "Your default". */
export type { WordCommentWhy };
/** Nothing is sent until the user decides. */
export type WordCommentBlock = "choose-comment" | "picked-gone" | "read-failed";
/** How a blocked Send goes on: without comments, with a thread the user chose, or not at all. */
export type WordCommentDecision =
  | { kind: "without" }
  | { kind: "pick"; ref: string }
  | { kind: "abort" };

export const WORD_COMMENT_PRECEDENCES: readonly WordCommentPrecedence[] = [
  "selection",
  "comment",
];

export interface WordCommentAdvertised {
  /** word_selection takes anchored_comments. */
  anchored: boolean;
  /** word_comment_thread takes thread_json and comments_json. */
  thread: boolean;
  /** The document facets that take comment_map. */
  map: ReadonlySet<string>;
}

export function wordCommentAdvertised(
  facetIds: ReadonlySet<string>,
  facetArgs: ReadonlyMap<string, ReadonlySet<string>>,
): WordCommentAdvertised {
  const takes = (facet: string, ...args: string[]) =>
    facetIds.has(facet) &&
    args.every((arg) => facetArgs.get(facet)?.has(arg) ?? false);
  return {
    anchored: takes(WORD_SELECTION_FACET_ID, WORD_ANCHORED_COMMENTS_ARG),
    thread: takes(
      WORD_COMMENT_THREAD_FACET_ID,
      WORD_THREAD_JSON_ARG,
      WORD_COMMENTS_JSON_ARG,
    ),
    map: new Set(
      [WORD_AUTHORING_FACET_ID, WORD_DOCUMENT_REVIEW_FACET_ID].filter((id) =>
        takes(id, WORD_COMMENT_MAP_ARG),
      ),
    ),
  };
}

export const wordCommentsAdvertised = (advertised: WordCommentAdvertised) =>
  advertised.anchored || advertised.thread || advertised.map.size > 0;

/**
 * Whether this Send reads comments: a thread facet can take a pick, the caret's thread or the open
 * threads; a passage its own; an included document its map. Nothing advertised, no read at all.
 */
export function wordCommentsDue(input: {
  advertised: WordCommentAdvertised;
  withoutComments: boolean;
  selectionDue: boolean;
  documentIncluded: boolean;
}): boolean {
  const { advertised } = input;
  return (
    !input.withoutComments &&
    (advertised.thread ||
      (input.selectionDue && advertised.anchored) ||
      (input.documentIncluded && advertised.map.size > 0))
  );
}

export type WordCommentSendSelection =
  /** No passage goes, and Word showed no caret in the body. */
  | { kind: "none" }
  /** The threads whose anchors touch the caret, in document order. */
  | { kind: "caret"; threads: readonly string[] }
  /** The passage word_selection carries and the threads that overlap it, in document order. */
  | { kind: "passage"; threads: readonly string[]; rewritable: boolean };

export interface WordCommentSendInput {
  advertised: WordCommentAdvertised;
  selection: WordCommentSendSelection;
  precedence: WordCommentPrecedence;
  /** The picked thread's ref; it stays until another pick, × or a new non-empty selection. */
  pick: string | null;
  /** The read at Send found the picked thread. */
  pickFound: boolean;
  override: WordCommentOverride | null;
  /** "Send without comments": the chip's × or the answer to a block. */
  withoutComments: boolean;
  documentIncluded: boolean;
  /** Sticky per chat. */
  includeOpenComments: boolean;
  /** Comments were due and Word did not hand them over. */
  readFailed: boolean;
}

export type WordCommentSendCarrier =
  | { kind: "none" }
  | { kind: "selection"; threads: readonly string[] }
  | { kind: "thread"; ref: string }
  | { kind: "open-comments" }
  | { kind: "map" };

export interface WordCommentSendPlan {
  carrier: WordCommentSendCarrier;
  block: WordCommentBlock | null;
  why: WordCommentWhy | null;
  /** 2+ threads in the passage and no pick: the passage goes and "Choose comment…" is offered. */
  offerChoose: boolean;
  /** Where the chip's switch leads for this message. */
  switchTo: WordCommentOverride | null;
}

const NONE: WordCommentSendCarrier = { kind: "none" };

const plan = (
  carrier: WordCommentSendCarrier,
  rest: Partial<Omit<WordCommentSendPlan, "carrier">> = {},
): WordCommentSendPlan => ({
  carrier,
  block: null,
  why: null,
  offerChoose: false,
  switchTo: null,
  ...rest,
});

const blocked = (block: WordCommentBlock) => plan({ kind: "none" }, { block });

/** Contract §8's table under either setting, for one message. */
export function resolveWordCommentSend(
  input: WordCommentSendInput,
): WordCommentSendPlan {
  const { advertised, selection } = input;
  const passageCarrier = (threads: readonly string[]) =>
    advertised.anchored ? { kind: "selection" as const, threads } : NONE;
  if (input.withoutComments || !wordCommentsAdvertised(advertised))
    return plan(NONE);
  if (input.readFailed) {
    // A caret read only to find its thread costs nothing to leave out.
    const mattered =
      selection.kind === "passage"
        ? advertised.anchored || advertised.thread
        : (advertised.thread &&
            (input.pick !== null ||
              (input.includeOpenComments && !input.documentIncluded))) ||
          (input.documentIncluded && advertised.map.size > 0);
    return mattered ? blocked("read-failed") : plan(NONE);
  }

  if (input.pick !== null && advertised.thread)
    return input.pickFound
      ? plan({ kind: "thread", ref: input.pick }, { why: "chosen" })
      : blocked("picked-gone");

  if (
    selection.kind === "caret" &&
    advertised.thread &&
    input.override !== "passage"
  ) {
    if (selection.threads.length === 1)
      return plan(
        { kind: "thread", ref: selection.threads[0] },
        { why: "cursor", switchTo: "passage" },
      );
    if (selection.threads.length > 1) return blocked("choose-comment");
  }

  if (selection.kind === "passage") {
    const { threads } = selection;
    if (threads.length > 1)
      return plan(passageCarrier(threads), {
        offerChoose: advertised.thread,
      });
    if (threads.length === 0) return plan(passageCarrier([]));
    // The setting covers only a selection Erato may replace (O-19); the rest is no one's default.
    const why: WordCommentWhy | null = input.override
      ? "chosen"
      : selection.rewritable
        ? "default"
        : null;
    const wants =
      input.override ?? (selection.rewritable ? input.precedence : "selection");
    if (wants === "comment" && advertised.thread)
      return plan(
        { kind: "thread", ref: threads[0] },
        { why, switchTo: "passage" },
      );
    return plan(passageCarrier(threads), {
      why,
      switchTo: advertised.thread ? "comment" : null,
    });
  }

  if (input.documentIncluded)
    return plan(advertised.map.size > 0 ? { kind: "map" } : NONE);
  if (input.includeOpenComments && advertised.thread)
    return plan({ kind: "open-comments" });
  return plan(NONE);
}

export interface WordCommentPick {
  ref: string;
  /** The selection the chip showed when the pick was made; another non-empty one ends the pick. */
  selectionKey: string | null;
}

export type WordCommentPickEvent =
  | { kind: "pick"; ref: string; selectionKey: string | null }
  /** The pick's ×. */
  | { kind: "dismiss" }
  /** The live selection changed; null when nothing is selected. */
  | { kind: "selection"; key: string | null }
  | { kind: "send" }
  /** Another chat or document. */
  | { kind: "context" };

/** A pick stays until another pick, ×, or a new non-empty selection (O-19). */
export function nextWordCommentPick(
  pick: WordCommentPick | null,
  event: WordCommentPickEvent,
): WordCommentPick | null {
  switch (event.kind) {
    case "pick":
      return { ref: event.ref, selectionKey: event.selectionKey };
    case "dismiss":
    case "context":
      return null;
    case "selection":
      return pick && event.key !== null && event.key !== pick.selectionKey
        ? null
        : pick;
    case "send":
      return pick;
  }
}

/** The comment id a ref was issued for in this pane session; null for a ref it never issued. */
export function wordCommentIdOfRef(
  registry: WordCommentRefRegistry,
  ref: string,
): string | null {
  let found: string | null = null;
  for (const [key, issued] of registry.refs)
    if (issued === ref && key.startsWith("id:"))
      found = key.slice(3).split("#")[0];
  return found;
}

/**
 * The threads a Send places exactly and lists replies for, most important first: the pick, then
 * the threads reaching the passage's or the caret's paragraphs. Others stay coarse (web anchors cost
 * about 0.7 s each, P-PERF).
 */
export function wordCommentSendExact(
  records: readonly WordCommentThreadRecord[],
  input: {
    passage: WordCommentSelectionCoordinates | null;
    live: WordCommentLiveSelection | null;
    pickedId: string | null;
  },
): string[] {
  const first = input.passage?.first ?? input.live?.first ?? null;
  const last = input.passage?.last ?? input.live?.last ?? null;
  const ids = input.pickedId ? [input.pickedId] : [];
  if (first === null || last === null) return ids;
  for (const record of records) {
    const from = record.anchor?.first.ordinal ?? null;
    const to = record.anchor?.last.ordinal ?? from;
    if (from !== null && to !== null && from <= last && to >= first)
      ids.push(record.id);
  }
  return [...new Set(ids)];
}

const IN_PASSAGE: ReadonlySet<WordCommentVs> = new Set([
  "inside",
  "contains",
  "overlaps_start",
  "overlaps_end",
]);

/** One Send's comments: refs frozen with the capture, every thread ready to send. */
export interface WordCommentSendRead {
  refs: WordCommentCaptureRefs;
  model: WordCommentModel;
  now: Date;
  userTz: string;
  /** The passage, or the caret Word showed in the body; null without either. */
  selection: WordCommentSelectionCoordinates | null;
  /** Threads in the passage or at the caret, in document order. */
  atSelection: string[];
}

export function wordCommentSendRead(input: {
  result: Extract<WordCommentReadResult, { ok: true }>;
  registry: WordCommentRefRegistry;
  passage: WordCommentSelectionCoordinates | null;
  people: WordCommentPeople;
  now: Date;
  userTz: string;
}): WordCommentSendRead {
  const { result, passage } = input;
  const live = result.selection;
  const selection =
    passage ??
    (live?.collapsed && live.first !== null
      ? wordCommentCaretCoordinates(live.first)
      : null);
  const refs = issueWordCommentRefs(
    input.registry,
    result.threads,
    result.legacy,
  );
  const positions = wordCommentPositions(
    result.threads.map((record, i) =>
      wordCommentPositionInput(record, refs.threads[i].ref),
    ),
    { selection },
  );
  const model = buildWordCommentModel({
    sources: wordCommentSources(result.threads, refs, positions),
    clock: {
      now: input.now,
      userTz: input.userTz,
      host: result.diagnostics.host,
      dateUtc: result.dateUtc,
    },
    people: input.people,
    legacy: result.legacy,
  });
  const atSelection = selection
    ? model.threads
        .filter(({ thread }) => {
          const { vs } = thread.where;
          return selection.caret
            ? vs === "at_caret"
            : !!vs && IN_PASSAGE.has(vs);
        })
        .map(({ thread }) => thread.id)
    : [];
  return {
    refs,
    model,
    now: input.now,
    userTz: input.userTz,
    selection,
    atSelection,
  };
}

/** What §8 sees of a Send: the passage, the caret, or neither. */
export function wordCommentSendSelection(
  read: WordCommentSendRead | null,
  passage: { rewritable: boolean } | null,
): WordCommentSendSelection {
  const threads = read?.atSelection ?? [];
  if (passage)
    return { kind: "passage", threads, rewritable: passage.rewritable };
  return read?.selection?.caret ? { kind: "caret", threads } : { kind: "none" };
}

function envelopeOf(
  read: WordCommentSendRead,
  scope: "selection" | "thread" | "document",
  full: readonly string[],
  essential: readonly string[],
  why: WordCommentWhy | null = null,
) {
  return buildWordCommentEnvelope({
    scope,
    model: read.model,
    now: read.now,
    userTz: read.userTz,
    full,
    essential,
    ...(read.selection
      ? { selection: wordCommentSelection(read.selection) }
      : {}),
    ...(why ? { why } : {}),
  });
}

/** anchored_comments: the passage's threads and the text-free coverage line. */
export function wordAnchoredCommentsArg(
  read: WordCommentSendRead,
  threads: readonly string[],
): string {
  return envelopeOf(read, "selection", threads, threads).json;
}

/**
 * word_comment_thread's arguments for one thread, or for the open threads with an empty
 * thread_json. The envelope says why the thread goes, so the sent message can say it too.
 */
export function wordCommentThreadArgs(
  read: WordCommentSendRead,
  ref: string | null,
  why: WordCommentWhy | null = null,
): { threadJson: string; commentsJson: string } {
  if (ref === null) {
    const open = read.model.threads
      .filter(({ thread }) => thread.status === "open")
      .map(({ thread }) => thread.id);
    return {
      threadJson: "",
      commentsJson: envelopeOf(read, "document", open, []).json,
    };
  }
  const built = envelopeOf(read, "thread", [ref], [ref], why);
  const thread = built.envelope.threads.find((t) => t.id === ref);
  return {
    threadJson: thread ? JSON.stringify(thread) : "",
    commentsJson: built.json,
  };
}

/** comment_map: the map's first page; word_read_comments continues from its cursor. */
export function wordCommentMapArg(
  read: WordCommentSendRead,
  headings: readonly WordCommentHeading[],
): string {
  const map = buildWordCommentMap({
    model: read.model,
    now: read.now,
    userTz: read.userTz,
    sections: wordCommentSections(headings),
  });
  const page = wordCommentMapPage(map, 0);
  return page ? JSON.stringify(page) : "";
}

/** The capture a Send stages, with the refs the turn's comment actions resolve against. */
export type WordCommentsCapture = WordDocumentCapture & {
  commentRefs?: WordCommentCaptureRefs;
};

export function withWordCommentRefs<T extends WordDocumentCapture>(
  capture: T,
  read: WordCommentSendRead | null,
): T & WordCommentsCapture {
  return read ? { ...capture, commentRefs: read.refs } : capture;
}

export const wordCommentRefsOf = (
  capture: WordCommentsCapture | null | undefined,
): WordCommentCaptureRefs | null => capture?.commentRefs ?? null;
