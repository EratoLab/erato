import { htmlToPlainText } from "@erato/frontend/library";
import { useEffect, useRef, useState } from "react";

import { publishComposeSelection } from "./composeSelectionStore";
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
// Watchdog for a single poll's callback. Classic Outlook Win32 was observed
// live (ERMAIN-431) hanging `getSelectedDataAsync(Text)` for 15s+ when the
// selection is complex Word-generated HTML — the host's html→text conversion
// chokes, while the Html coercion answers instantly. Without a watchdog the
// failure is invisible: polls keep firing, nothing returns, the selection
// silently never updates.
const POLL_CALLBACK_TIMEOUT_MS = 5000;
// A hung call occupies the host's serialized item-API slot (new calls fail
// with 5100 "Wait until the previous call completes"), so the poller must not
// stack calls behind it. After this long, give up waiting and let a fresh
// call through; the stuck call's late callback is dropped by sequence check.
const STUCK_CALL_ABANDON_MS = 30_000;
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
  // ERMAIN-431 state that must SURVIVE effect re-runs (the effect re-runs on
  // every `mailItem` identity churn, which is frequent):
  // - the Html-coercion switch is per SURFACE, not per effect instance — as an
  //   effect local it kept resetting to Text and re-hanging (observed live);
  // - the in-flight guard tracks the HOST's serialized API slot, which is
  //   global — a re-run must not double-issue while a call is stuck.
  const useHtmlCoercionRef = useRef(false);
  const callSeqRef = useRef(0);
  const inFlightSeqRef = useRef<number | null>(null);
  const inFlightSinceRef = useRef(0);
  const timedOutStreakRef = useRef(0);
  // Raw (pre-extraction) Html payload of the last poll, so the ~80ms
  // htmlToPlainText conversion runs only when the selection actually changed.
  const lastRawHtmlRef = useRef<string | null>(null);

  useEffect(() => {
    const item = Office.context.mailbox.item as
      | Office.MessageRead
      | Office.MessageCompose
      | null;

    const commitEmpty = () => {
      lastDataRef.current = "";
      lastSourceRef.current = "body";
      setSelection(EMPTY_SELECTION);
      publishComposeSelection(EMPTY_SELECTION);
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
      // The coercion choice is a per-SURFACE adaptation; a new surface starts
      // fresh on the fast Text path. (The in-flight refs are deliberately NOT
      // reset — a stuck call from the previous surface still occupies the
      // host's global API slot.)
      useHtmlCoercionRef.current = false;
      lastRawHtmlRef.current = null;
    }

    let cancelled = false;
    let lastLoggedErrorCode: number | undefined;
    let consecutiveInternalErrors = 0;

    const switchToHtmlCoercion = (reason: string) => {
      if (useHtmlCoercionRef.current) return;
      useHtmlCoercionRef.current = true;
      console.warn(
        `[selection-poll] ${reason} — switching this surface to Html coercion with client-side text extraction (ERMAIN-431)`,
      );
    };

    const poll = () => {
      if (cancelled) return;

      const composeItem = Office.context.mailbox
        .item as Office.MessageCompose | null;
      if (!composeItem) return;

      if (inFlightSeqRef.current !== null) {
        // A call is still outstanding — issuing another would only fail with
        // 5100. Skip this tick unless the outstanding call is old enough to
        // abandon (its late callback is then ignored via the seq check).
        if (Date.now() - inFlightSinceRef.current < STUCK_CALL_ABANDON_MS) {
          return;
        }
        console.warn(
          `[selection-poll] abandoning a getSelectedDataAsync call stuck for ${STUCK_CALL_ABANDON_MS}ms; a late callback will be ignored`,
        );
        inFlightSeqRef.current = null;
      }

      callSeqRef.current += 1;
      const seq = callSeqRef.current;
      inFlightSeqRef.current = seq;
      inFlightSinceRef.current = Date.now();
      const coercion = useHtmlCoercionRef.current
        ? Office.CoercionType.Html
        : Office.CoercionType.Text;

      let callbackFired = false;
      const watchdog = setTimeout(() => {
        if (callbackFired || cancelled) return;
        timedOutStreakRef.current += 1;
        if (
          timedOutStreakRef.current === 1 ||
          timedOutStreakRef.current % 10 === 0
        ) {
          console.warn(
            `[selection-poll] getSelectedDataAsync callback did not fire within ${POLL_CALLBACK_TIMEOUT_MS}ms` +
              ` (${timedOutStreakRef.current} consecutive) — Office host API appears wedged; selection detection is blind`,
          );
        }
        if (coercion === Office.CoercionType.Text) {
          switchToHtmlCoercion("text coercion hung");
        }
      }, POLL_CALLBACK_TIMEOUT_MS);

      composeItem.getSelectedDataAsync(
        coercion,
        // Office.js types MessageCompose.getSelectedDataAsync as AsyncResult<any>;
        // the actual value is { data: string, sourceProperty: "body" | "subject" }.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result: Office.AsyncResult<any>) => {
          callbackFired = true;
          clearTimeout(watchdog);
          if (inFlightSeqRef.current !== seq) {
            // Abandoned call finally answering — a newer call owns the slot
            // (or will); its data may be stale, so drop it entirely.
            return;
          }
          inFlightSeqRef.current = null;
          if (timedOutStreakRef.current > 0) {
            console.warn(
              `[selection-poll] callbacks resumed after ${timedOutStreakRef.current} timed-out poll(s)`,
            );
            timedOutStreakRef.current = 0;
          }
          if (cancelled) return;

          if (result.status === Office.AsyncResultStatus.Succeeded) {
            lastLoggedErrorCode = undefined;
            consecutiveInternalErrors = 0;
            const raw: string = result.value?.data ?? "";
            const sourceProperty: "body" | "subject" =
              result.value?.sourceProperty === "subject" ? "subject" : "body";

            let data: string;
            if (coercion === Office.CoercionType.Html) {
              // The html→text extraction costs ~80ms on Word-styled content —
              // skip it when the raw payload didn't change since last poll.
              if (
                raw === lastRawHtmlRef.current &&
                sourceProperty === lastSourceRef.current
              ) {
                return;
              }
              lastRawHtmlRef.current = raw;
              data = raw.length > 0 ? htmlToPlainText(raw) : "";
            } else {
              lastRawHtmlRef.current = null;
              data = raw;
            }

            // Deduplicate: only update state when selection actually changed.
            if (
              data !== lastDataRef.current ||
              sourceProperty !== lastSourceRef.current
            ) {
              lastDataRef.current = data;
              lastSourceRef.current = sourceProperty;
              setSelection({ data, sourceProperty });
              publishComposeSelection({ data, sourceProperty });
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
          // 5001 "An internal error has occurred" accompanies the text-
          // coercion hang (observed live); repeated occurrences are the same
          // signal as a timeout.
          if (
            result.error?.code === 5001 &&
            coercion === Office.CoercionType.Text
          ) {
            consecutiveInternalErrors += 1;
            if (consecutiveInternalErrors >= 2) {
              switchToHtmlCoercion("text coercion failed repeatedly (5001)");
            }
          } else {
            consecutiveInternalErrors = 0;
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
