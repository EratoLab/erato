import { useSyncExternalStore } from "react";

import { nextWordCommentPick } from "../utils/wordCommentSend";

import type {
  WordCommentOverride,
  WordCommentPick,
  WordCommentPickEvent,
} from "../utils/wordCommentSend";

/**
 * What the user said about comments for the composer's next Send (contract §8): the pick, the
 * chip's switch, "Send without comments" and "Include open comments". The chips and the picker
 * write here; the composer reads it at Send and resets what one message spends.
 */
export interface WordCommentGestures {
  pick: WordCommentPick | null;
  /** The chip's switch, for the next message only. */
  override: WordCommentOverride | null;
  /** "Send without comments", for the next message only. */
  withoutComments: boolean;
  /** Sticky for the chat. */
  includeOpenComments: boolean;
}

export const NO_WORD_COMMENT_GESTURES: WordCommentGestures = {
  pick: null,
  override: null,
  withoutComments: false,
  includeOpenComments: false,
};

let snapshot = NO_WORD_COMMENT_GESTURES;
const listeners = new Set<() => void>();

function publish(next: WordCommentGestures) {
  if (
    next.pick === snapshot.pick &&
    next.override === snapshot.override &&
    next.withoutComments === snapshot.withoutComments &&
    next.includeOpenComments === snapshot.includeOpenComments
  )
    return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

export const wordCommentGestureStore = {
  getSnapshot,
  useSnapshot: () => useSyncExternalStore(subscribe, getSnapshot),
  set(change: Partial<Omit<WordCommentGestures, "pick">>) {
    publish({ ...snapshot, ...change });
  },
  pick(event: WordCommentPickEvent) {
    publish({ ...snapshot, pick: nextWordCommentPick(snapshot.pick, event) });
  },
  /** A Send spends the switch and "Send without comments"; the pick stays. */
  sent() {
    publish({
      ...snapshot,
      pick: nextWordCommentPick(snapshot.pick, { kind: "send" }),
      override: null,
      withoutComments: false,
    });
  },
  /** Another document forgets its refs; another chat also turns "Include open comments" off. */
  leave(scope: "chat" | "document") {
    publish({
      ...NO_WORD_COMMENT_GESTURES,
      includeOpenComments: scope === "document" && snapshot.includeOpenComments,
    });
  },
  resetForTests() {
    snapshot = NO_WORD_COMMENT_GESTURES;
    listeners.clear();
  },
};
