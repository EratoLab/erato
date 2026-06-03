import { useEffect, useRef, useState } from "react";

import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { isMessageRead } from "../sessionPolicy";
import { selLog } from "../utils/selectionDebug";

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
// Grace period before clearing the selection when the mail item momentarily
// disappears. In reply / inline-compose contexts `Office.context.mailbox.item`
// (and the provider's `mailItem`) flap to null for a beat; clearing on the spot
// made the selection chip flicker. We hold the last selection and only clear if
// the item is still gone — or has become a read item — after this window.
const NULL_GRACE_MS = 2500;

/**
 * Polls `getSelectedDataAsync` while in compose mode, providing reactive
 * selection state. This is the single source of truth for what the user
 * has selected in the Outlook compose window.
 *
 * Office.js has no selection-change events, so we poll on an interval.
 *
 * The selection is held across transient null-item windows (a reply/inline
 * compose context briefly reports no item) so the consuming chip doesn't
 * flicker; it is only cleared on a positive read-mode switch or once the
 * item is still gone after {@link NULL_GRACE_MS}.
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

    const commitEmpty = () => {
      lastDataRef.current = "";
      lastSourceRef.current = "body";
      setSelection(EMPTY_SELECTION);
    };

    // Positive read mode: the user is reading a received email, not composing.
    // There is no compose selection to preview — clear right away.
    if (item && isMessageRead(item)) {
      selLog("hook: read mode — clearing selection");
      commitEmpty();
      return;
    }

    // Transient/unknown context: the provider's `mailItem` or the raw Office
    // item is momentarily null. Clearing here is what made the chip flicker, so
    // instead hold the last selection and only clear if the context is STILL
    // gone (or has become a read item) after a short grace period. If a valid
    // compose item returns first, this effect re-runs and cancels the timer.
    if (!mailItem || !item) {
      selLog(
        `hook: transient null — holding selection (hasMailItem=${!!mailItem} hasItem=${!!item})`,
      );
      const graceTimer = setTimeout(() => {
        const latest = Office.context.mailbox.item as
          | Office.MessageRead
          | Office.MessageCompose
          | null;
        if (!latest || isMessageRead(latest)) {
          selLog("hook: grace expired, no compose item — clearing selection");
          commitEmpty();
        }
      }, NULL_GRACE_MS);

      return () => clearTimeout(graceTimer);
    }

    selLog("hook: entering compose polling");

    // Note: dedup refs are intentionally NOT reset here. They track the last
    // emitted value so a held selection stays consistent across a transient
    // null — and a genuine change (including a deselect → empty) still
    // propagates because the new poll value differs from the retained ref.

    let cancelled = false;

    const poll = () => {
      if (cancelled) return;

      const composeItem = Office.context.mailbox
        .item as Office.MessageCompose | null;
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
              selLog(
                `hook: state update len=${data.length} src=${sourceProperty}`,
              );
            }
          } else {
            // Normally ignored (e.g. InvalidSelection when cursor is outside
            // body/subject); logged here so we can see in-host failures.
            selLog(
              `hook: poll FAIL code=${result.error?.code} msg=${result.error?.message}`,
            );
          }
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
