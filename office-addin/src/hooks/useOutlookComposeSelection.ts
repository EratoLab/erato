import { useEffect, useRef, useState } from "react";

import {
  isMessageRead,
  useOutlookMailItem,
} from "../providers/OutlookMailItemProvider";

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
  const lastSourceRef = useRef<"body" | "subject">("body");

  useEffect(() => {
    const item = Office.context.mailbox.item as
      | Office.MessageRead
      | Office.MessageCompose
      | null;

    if (!mailItem || !item || isMessageRead(item)) {
      setSelection(EMPTY_SELECTION);
      lastDataRef.current = "";
      lastSourceRef.current = "body";
      return;
    }

    // Reset dedup refs so the first poll of a new draft always propagates.
    lastDataRef.current = "";
    lastSourceRef.current = "body";

    let cancelled = false;

    const poll = () => {
      if (cancelled) return;

      const composeItem = Office.context.mailbox.item as Office.MessageCompose | null;
      if (!composeItem) return;

      composeItem.getSelectedDataAsync(
        Office.CoercionType.Text,
        // Office.js types MessageCompose.getSelectedDataAsync as AsyncResult<any>;
        // the actual value is { data: string, sourceProperty: "body" | "subject" }.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result: Office.AsyncResult<any>) => {
          if (cancelled) return;

          if (result.status === Office.AsyncResultStatus.Succeeded) {
            const data: string = result.value?.data ?? "";
            const sourceProperty: "body" | "subject" =
              result.value?.sourceProperty === "subject" ? "subject" : "body";

            // Deduplicate: only update state when selection actually changed.
            if (
              data !== lastDataRef.current ||
              sourceProperty !== lastSourceRef.current
            ) {
              lastDataRef.current = data;
              lastSourceRef.current = sourceProperty;
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
  }, [mailItem]);

  return selection;
}
