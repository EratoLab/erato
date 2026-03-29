import { useCallback, useEffect, useRef, useState } from "react";

import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";

export interface OutlookComposeSelection {
  /** The selected text content. Empty string when nothing is selected. */
  data: string;
  /** Whether the selection comes from the email body or subject. */
  sourceProperty: "body" | "subject";
}

const EMPTY_SELECTION: OutlookComposeSelection = {
  data: "",
  sourceProperty: "body",
};
const POLL_INTERVAL_MS = 2500;

/**
 * Polls `getSelectedDataAsync` while in compose mode, providing reactive
 * selection state. This is the single source of truth for what the user
 * has selected in the Outlook compose window.
 *
 * Office.js has no selection-change events, so we poll on an interval.
 */
export function useOutlookComposeSelection(): OutlookComposeSelection {
  const { mailItem } = useOutlookMailItem();
  const [selection, setSelection] =
    useState<OutlookComposeSelection>(EMPTY_SELECTION);
  const lastDataRef = useRef("");

  // Determine if we're in compose mode.
  // In compose mode, `subject` is read asynchronously and starts as "".
  // For read mode, OutlookMailItemProvider sets subject synchronously from
  // `item.subject` (a string). The provider also only sets `mailItem` after
  // compose fields have been kicked off, so the presence of mailItem plus
  // the isMessageRead guard upstream is sufficient. However, this hook sits
  // outside the provider internals, so we rely on the Office.context item
  // directly.
  const isCompose = useCallback(() => {
    const item = Office.context.mailbox.item;
    if (!item) return false;
    // In read mode, `subject` is a plain string property.
    // In compose mode, `subject` is a `Subject` object with getAsync/setAsync.
    return typeof (item as Office.MessageRead).subject !== "string";
  }, []);

  useEffect(() => {
    if (!mailItem || !isCompose()) {
      if (selection.data !== "") {
        setSelection(EMPTY_SELECTION);
        lastDataRef.current = "";
      }
      return;
    }

    let cancelled = false;

    const poll = () => {
      if (cancelled) return;

      const item = Office.context.mailbox.item as Office.MessageCompose | null;
      if (!item) return;

      item.getSelectedDataAsync(
        Office.CoercionType.Text,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result: Office.AsyncResult<any>) => {
          if (cancelled) return;

          if (result.status === Office.AsyncResultStatus.Succeeded) {
            const data: string = result.value?.data ?? "";
            const sourceProperty: "body" | "subject" =
              result.value?.sourceProperty === "subject" ? "subject" : "body";

            // Deduplicate: only update state when content actually changed.
            if (data !== lastDataRef.current) {
              lastDataRef.current = data;
              setSelection({ data, sourceProperty });
            }
          }
          // Silently ignore errors (e.g. InvalidSelection when cursor is
          // outside body/subject). Selection simply stays at its last value.
        },
      );
    };

    // Initial poll immediately, then on interval.
    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // Re-run when the mail item changes (e.g. user opens a different draft).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailItem, isCompose]);

  return selection;
}
