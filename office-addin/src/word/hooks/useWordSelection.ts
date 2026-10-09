import { useEffect } from "react";

import { EMPTY_WORD_SELECTION, wordSelectionStore } from "./wordSelectionStore";
import { subscribeToOfficeSelectionChanged } from "../../hooks/officeSelectionChangedBroker";
import {
  consumeProgrammaticSelectionEvent,
  onProgrammaticWordSelection,
  PROGRAMMATIC_SELECTION_WINDOW_MS,
} from "../utils/wordProgrammaticSelection";
import { describeWordSelection } from "../utils/wordSelectionCapture";

import type { WordSelectionOrigin } from "../utils/wordSelectionAnchor";

/** Word merges rapid input into one event anyway; this keeps a drag from reading on every step. */
export const WORD_SELECTION_DEBOUNCE_MS = 250;

/**
 * The single live reader of the Word selection: it re-reads after each DocumentSelectionChanged
 * and publishes to wordSelectionStore. Events are hints only (re-selecting the same range fires
 * none, a long typing burst on PC fired none), so Send reads the selection again itself. Without
 * selection events there is no chip.
 */
export function useWordSelection(
  documentIdentity: string,
  enabled: boolean,
): void {
  useEffect(() => {
    const publish = wordSelectionStore.publish;
    publish(EMPTY_WORD_SELECTION);
    if (!enabled) return;

    let active = true;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let origin: WordSelectionOrigin = "user";

    const read = async (readSequence: number) => {
      const result = await describeWordSelection();
      if (!active || readSequence !== sequence) return;
      const current = wordSelectionStore.getSnapshot();
      if (result.status === "failed") {
        publish({
          ...current,
          armed: origin === "user" && current.armed,
          pending: false,
        });
        return;
      }
      publish({
        preview: result.value,
        origin,
        armed: origin === "user",
        pending: false,
      });
    };
    const schedule = (next: WordSelectionOrigin, delay: number) => {
      origin = next;
      sequence += 1;
      const readSequence = sequence;
      clearTimeout(timer);
      if (next === "user")
        publish({ ...wordSelectionStore.getSnapshot(), pending: true });
      timer = setTimeout(() => {
        timer = undefined;
        void read(readSequence);
      }, delay);
    };

    const unsubscribe = subscribeToOfficeSelectionChanged({
      onSelectionChanged: () => {
        if (!active) return;
        schedule(
          consumeProgrammaticSelectionEvent() ? "erato" : "user",
          WORD_SELECTION_DEBOUNCE_MS,
        );
      },
      onUnavailable: () => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        publish(EMPTY_WORD_SELECTION);
      },
    });
    // Erato is about to move the selection: until its event is read, Send must not take the passage
    // Word then holds for the user's. The read also runs if the event never comes.
    const stopMarks = onProgrammaticWordSelection(() => {
      if (!active) return;
      publish({
        ...wordSelectionStore.getSnapshot(),
        origin: "erato",
        armed: false,
        pending: false,
      });
      schedule("erato", PROGRAMMATIC_SELECTION_WINDOW_MS);
    });
    const stopRefresh = wordSelectionStore.subscribeRefresh(({ rearm }) => {
      if (active)
        schedule(rearm ? "user" : wordSelectionStore.getSnapshot().origin, 0);
    });
    if (active) schedule("user", 0);

    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      stopMarks();
      stopRefresh();
      publish(EMPTY_WORD_SELECTION);
    };
  }, [documentIdentity, enabled]);
}
