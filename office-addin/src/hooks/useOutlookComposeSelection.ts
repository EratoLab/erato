import { useEffect, useRef, useState } from "react";

import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { isMessageRead } from "../sessionPolicy";

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
// Watchdog for a single poll's callback. Office.js occasionally stops
// delivering callbacks entirely (host-side wedge, observed live after a
// programmatic setSelectedDataAsync) — without this the failure is invisible:
// polls keep firing, nothing returns, the selection silently never updates.
const POLL_CALLBACK_TIMEOUT_MS = 5000;
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
 * flicker; it is cleared on a positive read-mode switch, on a switch to a
 * different compose surface (so a stale selection can't carry over to the new
 * draft), or once the item is still gone after {@link NULL_GRACE_MS}.
 */
export function useOutlookComposeSelection(): OutlookComposeSelection {
  const { mailItem } = useOutlookMailItem();
  const [selection, setSelection] =
    useState<OutlookComposeSelection>(EMPTY_SELECTION);
  const lastDataRef = useRef("");
  const lastSourceRef = useRef<"body" | "subject">("body");
  // The compose surface (conversation + mode) the held selection belongs to,
  // so a switch to a *different* surface can drop a stale selection.
  const selectionSurfaceRef = useRef<{
    conversationId: string | null;
    isCompose: boolean;
  } | null>(null);

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
      commitEmpty();
      return;
    }

    // Transient/unknown context: the provider's `mailItem` or the raw Office
    // item is momentarily null. Clearing here is what made the chip flicker, so
    // instead hold the last selection and only clear if the context is STILL
    // gone (or has become a read item) after a short grace period. If a valid
    // compose item returns first, this effect re-runs and cancels the timer.
    if (!mailItem || !item) {
      const graceTimer = setTimeout(() => {
        const latest = Office.context.mailbox.item as
          | Office.MessageRead
          | Office.MessageCompose
          | null;
        if (!latest || isMessageRead(latest)) {
          commitEmpty();
        }
      }, NULL_GRACE_MS);

      return () => clearTimeout(graceTimer);
    }

    // A switch to a *different* compose surface must drop the held selection at
    // once: otherwise the previous draft's selection stays eligible for
    // `outlook_rewrite_selection` until the new item's first poll resolves — and
    // indefinitely if that poll fails (e.g. the cursor isn't in the body yet).
    // We key on the session anchor (conversationId + compose flag), NOT the
    // provider's `itemIdentity`: that falls back to a random value for a
    // brand-new compose with no conversationId, so it would reset spuriously on
    // body-load re-renders and redundant ItemChanged events. Two distinct blank
    // composes (both null conversationId) share an anchor and aren't told apart
    // — a rare case the first poll still corrects.
    const currentSurface = {
      conversationId: mailItem.conversationId,
      isCompose: mailItem.isComposeMode,
    };
    const previousSurface = selectionSurfaceRef.current;
    const isSameSurface =
      previousSurface !== null &&
      previousSurface.conversationId === currentSurface.conversationId &&
      previousSurface.isCompose === currentSurface.isCompose;
    selectionSurfaceRef.current = currentSurface;

    // Same surface: keep the dedup refs so the held selection survives a
    // transient null and only a genuine change (including deselect → empty)
    // re-emits. Different surface: clear now (on first mount this is a no-op —
    // the selection and refs already start empty).
    if (!isSameSurface) {
      commitEmpty();
    }

    let cancelled = false;
    // Consecutive polls whose callback never fired — a wedged host API.
    // Warn on the first and then sparsely, so a dead bridge is visible in the
    // console without spamming a line every poll.
    let timedOutStreak = 0;
    let lastLoggedErrorCode: number | undefined;

    const poll = () => {
      if (cancelled) return;

      const composeItem = Office.context.mailbox
        .item as Office.MessageCompose | null;
      if (!composeItem) return;

      let callbackFired = false;
      const watchdog = setTimeout(() => {
        if (callbackFired || cancelled) return;
        timedOutStreak += 1;
        if (timedOutStreak === 1 || timedOutStreak % 10 === 0) {
          console.warn(
            `[selection-poll] getSelectedDataAsync callback did not fire within ${POLL_CALLBACK_TIMEOUT_MS}ms` +
              ` (${timedOutStreak} consecutive) — Office host API appears wedged; selection detection is blind`,
          );
        }
      }, POLL_CALLBACK_TIMEOUT_MS);

      composeItem.getSelectedDataAsync(
        Office.CoercionType.Text,
        // Office.js types MessageCompose.getSelectedDataAsync as AsyncResult<any>;
        // the actual value is { data: string, sourceProperty: "body" | "subject" }.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result: Office.AsyncResult<any>) => {
          callbackFired = true;
          clearTimeout(watchdog);
          if (timedOutStreak > 0) {
            console.warn(
              `[selection-poll] callbacks resumed after ${timedOutStreak} timed-out poll(s)`,
            );
            timedOutStreak = 0;
          }
          if (cancelled) return;

          if (result.status === Office.AsyncResultStatus.Succeeded) {
            lastLoggedErrorCode = undefined;
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
              if (import.meta.env.DEV) {
                console.debug(
                  data.length > 0
                    ? `[selection-poll] selection detected (${data.length} chars, ${sourceProperty})`
                    : "[selection-poll] selection cleared",
                );
              }
            }
            return;
          }
          // A failed poll (e.g. InvalidSelection when the cursor is outside
          // body/subject) is routine — the last selection is retained. Log
          // only when the error CHANGES so a new failure mode is visible.
          if (result.error?.code !== lastLoggedErrorCode) {
            lastLoggedErrorCode = result.error?.code;
            if (import.meta.env.DEV) {
              console.debug(
                "[selection-poll] getSelectedDataAsync failed:",
                result.error?.code,
                result.error?.message,
              );
            }
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
