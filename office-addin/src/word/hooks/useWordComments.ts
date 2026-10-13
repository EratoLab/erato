import { wordCommentVsInSelection } from "@erato/frontend/word-review";
import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeToOfficeSelectionChanged } from "../../hooks/officeSelectionChangedBroker";
import {
  wordCommentCaretCoordinates,
  wordCommentPositionInput,
  wordCommentPositions,
  wordCommentWhere,
} from "../utils/wordCommentPositions";
import { readWordComments } from "../utils/wordCommentReader";
import {
  issueWordCommentRefs,
  wordCommentIdOfRef,
  wordCommentRefRegistry,
} from "../utils/wordCommentRefs";
import { wordCommentSendExact } from "../utils/wordCommentSend";
import {
  subscribeWordDocumentChanged,
  wordParagraphEventsActive,
} from "../utils/wordDocumentChangeSignal";

import type { WordCommentSelectionCoordinates } from "../utils/wordCommentPositions";
import type {
  WordCommentAnchorCache,
  WordCommentReadResult,
} from "../utils/wordCommentReader";
import type { WordCommentRefRegistry } from "../utils/wordCommentRefs";
import type { WordCommentStatus } from "@erato/frontend/word-review";

/** Word merges a drag into a burst of selection events; one read follows the last. */
export const WORD_COMMENTS_DEBOUNCE_MS = 400;

export interface WordCommentListThread {
  ref: string;
  commentId: string;
  author: string;
  status: WordCommentStatus;
  /** The visible anchored text, both ends kept when long; "" for a point comment. */
  quote: string;
  /** The thread's comment, on one line. */
  text: string;
  /** Null when Word's replies were not listed. */
  replies: number | null;
  /** The latest time Word gave for the comment or a listed reply; null when it gave none. */
  lastActivity: Date | null;
  /** Dense and 1-based, in document order. */
  pos: number;
  /** The anchor reaches the selected passage, or touches the caret. */
  inSelection: boolean;
}

export type WordCommentListSelection =
  | { kind: "none" }
  /** The threads touching the caret, in document order. */
  | { kind: "caret"; threads: readonly string[] }
  /** The threads reaching the selected passage, in document order. */
  | { kind: "passage"; threads: readonly string[] };

export interface WordCommentList {
  status: "idle" | "reading" | "ready" | "failed";
  /** Threads with a known paragraph, in document order; only these can be picked and sent. */
  threads: readonly WordCommentListThread[];
  counts: { open: number; resolved: number };
  /** Threads Word listed without a paragraph the pane could place. */
  unplaced: number;
  selection: WordCommentListSelection;
  /** The replies listed so far while the picker reads. */
  progress: { done: number; total: number } | null;
}

export const NO_WORD_COMMENT_LIST: WordCommentList = {
  status: "idle",
  threads: [],
  counts: { open: 0, resolved: 0 },
  unplaced: 0,
  selection: { kind: "none" },
  progress: null,
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function latest(dates: readonly (Date | null)[]): Date | null {
  let found: Date | null = null;
  for (const date of dates)
    if (date && (!found || date.getTime() > found.getTime())) found = date;
  return found;
}

/**
 * Where Word's selection was at the read, in paragraphs only: the light read has no offsets, so
 * anchors in the selection's own paragraphs are placed by Word's compareLocationWith instead.
 */
function liveCoordinates(
  live: Extract<WordCommentReadResult, { ok: true }>["selection"],
): WordCommentSelectionCoordinates | null {
  if (!live || live.first === null || live.last === null) return null;
  return live.collapsed
    ? wordCommentCaretCoordinates(live.first)
    : { first: live.first, last: live.last, start: null, end: null };
}

/** The picker's and the chip's view of one read, with the session's refs. */
export function wordCommentListOf(
  result: Extract<WordCommentReadResult, { ok: true }>,
  registry: WordCommentRefRegistry,
): Pick<WordCommentList, "threads" | "counts" | "unplaced" | "selection"> {
  const selection = liveCoordinates(result.selection);
  const refs = issueWordCommentRefs(registry, result.threads, result.legacy);
  const positions = wordCommentPositions(
    result.threads.map((record, i) =>
      wordCommentPositionInput(record, refs.threads[i].ref),
    ),
    { selection },
  );
  const threads: WordCommentListThread[] = [];
  let unplaced = 0;
  result.threads.forEach((record, i) => {
    const ref = refs.threads[i].ref;
    const position = positions.get(ref);
    const where = position ? wordCommentWhere(record, position) : null;
    if (!position || !where) {
      unplaced += 1;
      return;
    }
    threads.push({
      ref,
      commentId: record.id,
      author: record.authorName,
      status: record.resolved ? "resolved" : "open",
      quote: where.point ? "" : oneLine(where.quote),
      text: oneLine(record.content),
      replies: record.replies?.length ?? null,
      lastActivity: latest([
        record.creationDate,
        ...(record.replies ?? []).map((reply) => reply.creationDate),
      ]),
      pos: position.pos,
      inSelection: wordCommentVsInSelection(where.vs),
    });
  });
  threads.sort((a, b) => a.pos - b.pos);
  const at = threads.filter((t) => t.inSelection).map((t) => t.ref);
  return {
    threads,
    counts: {
      open: threads.filter((t) => t.status === "open").length,
      resolved: threads.filter((t) => t.status === "resolved").length,
    },
    unplaced,
    selection: !selection
      ? { kind: "none" }
      : selection.caret
        ? { kind: "caret", threads: at }
        : { kind: "passage", threads: at },
  };
}

export interface UseWordCommentsOptions {
  documentIdentity: string;
  /** Only while config advertises a comment carrier; otherwise Word is never asked. */
  enabled: boolean;
  /** The picker is open: every thread's replies are listed. */
  detailed: boolean;
  /** The picked thread, whose replies the chip counts. */
  picked: string | null;
}

/**
 * The live comment list behind the chips and the picker (contract §8, §11). It reads Word again
 * after selection changes, debounced, on pane focus and on refresh (the picker's open and Refresh),
 * and never on a timer: every Send and every write read again anyway. Each read lists the threads,
 * their coarse anchors and the selection's relation to them; replies only for the threads at the
 * selection and the pick, or for all while the picker is open (Word for Mac lists them slowly).
 * No package is read for exact anchors, so a read costs no OOXML on the web unless a commented
 * paragraph has hidden text; on desktop the first read of a document learns whether it is legacy,
 * so even the picker's refs come from content where ids do not last (O-17). Reads never overlap;
 * one asked for during a read runs once after it. A selection change while Word lists the same
 * comments and no paragraph event has fired since keeps the earlier read's anchors; focus, refresh
 * and every Send read them all again.
 */
export function useWordComments({
  documentIdentity,
  enabled,
  detailed,
  picked,
}: UseWordCommentsOptions): {
  list: WordCommentList;
  refresh: () => void;
} {
  const [list, setList] = useState(NO_WORD_COMMENT_LIST);
  const wantedRef = useRef({ detailed, picked });
  wantedRef.current = { detailed, picked };
  const scheduleRef = useRef<(delayMs: number, full: boolean) => void>(
    () => {},
  );

  useEffect(() => {
    setList(NO_WORD_COMMENT_LIST);
    if (!enabled) return;
    let active = true;
    let running = false;
    let again = false;
    let fullWanted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const anchors: WordCommentAnchorCache = { generation: 0, snapshot: null };
    const stopChanges = subscribeWordDocumentChanged(() => {
      anchors.generation += 1;
      anchors.snapshot = null;
    });

    const readOnce = async () => {
      const wanted = wantedRef.current;
      // Without paragraph events an edit leaves no trace, so the anchors are read again.
      const reuse = !fullWanted && wordParagraphEventsActive();
      fullWanted = false;
      const registry = wordCommentRefRegistry(documentIdentity);
      const pickedId = wanted.picked
        ? wordCommentIdOfRef(registry, wanted.picked)
        : null;
      setList((current) => ({ ...current, status: "reading", progress: null }));
      const result = await readWordComments({
        selection: true,
        packages: false,
        legacy: registry.legacy,
        replies: wanted.detailed ? "all" : "requested",
        exact: (records, live) =>
          wordCommentSendExact(records, { passage: null, live, pickedId }),
        anchors: { cache: anchors, reuse },
        ...(wanted.detailed
          ? {
              onProgress: (done: number, total: number, phase: string) => {
                if (active && phase === "replies")
                  setList((current) => ({
                    ...current,
                    progress: { done, total },
                  }));
              },
            }
          : {}),
      });
      if (!active) return;
      setList((current) =>
        result.ok
          ? {
              status: "ready",
              ...wordCommentListOf(result, registry),
              progress: null,
            }
          : { ...current, status: "failed", progress: null },
      );
    };
    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await readOnce();
        } while (again && active);
      } finally {
        running = false;
      }
    };
    const schedule = (delayMs: number, full: boolean) => {
      if (!active) return;
      if (full) fullWanted = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, delayMs);
    };
    scheduleRef.current = schedule;

    const unsubscribe = subscribeToOfficeSelectionChanged({
      onSelectionChanged: () => schedule(WORD_COMMENTS_DEBOUNCE_MS, false),
    });
    const onFocus = () => schedule(0, true);
    globalThis.addEventListener("focus", onFocus);
    schedule(0, true);
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      stopChanges();
      globalThis.removeEventListener("focus", onFocus);
      scheduleRef.current = () => {};
    };
  }, [documentIdentity, enabled]);

  const refresh = useCallback(() => scheduleRef.current(0, true), []);
  return { list, refresh };
}
