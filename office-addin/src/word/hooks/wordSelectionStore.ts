import { createSelectionSnapshotStore } from "../../core/selection/selectionSnapshotStore";

import type { WordSelectionOrigin } from "../utils/wordSelectionAnchor";
import type { WordSelectionPreview } from "../utils/wordSelectionCapture";

export interface WordSelectionState {
  /** Null when nothing is selected that could be sent. */
  preview: WordSelectionPreview | null;
  origin: WordSelectionOrigin;
  /**
   * Send reads the selection only when it is armed: a passage Erato selected itself (Locate, Show
   * in Word) is shown, but not sent until the user takes it over.
   */
  armed: boolean;
  /** The user changed the selection and its read has not been published yet. */
  pending: boolean;
}

export const EMPTY_WORD_SELECTION: WordSelectionState = {
  preview: null,
  origin: "user",
  armed: false,
  pending: false,
};

export const wordSelectionStore = createSelectionSnapshotStore({
  empty: EMPTY_WORD_SELECTION,
  equals: (a: WordSelectionState, b: WordSelectionState) =>
    a.preview?.key === b.preview?.key &&
    a.origin === b.origin &&
    a.armed === b.armed &&
    a.pending === b.pending,
});

/** "Use this selection": the user takes over a passage Erato selected. */
export function armWordSelection(): void {
  const current = wordSelectionStore.getSnapshot();
  if (current.preview)
    wordSelectionStore.publish({ ...current, origin: "user", armed: true });
}
