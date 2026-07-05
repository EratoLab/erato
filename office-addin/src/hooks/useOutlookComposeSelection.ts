import { htmlToPlainText } from "@erato/frontend/library";
import { useEffect, useRef, useState } from "react";

import {
  isComposeSelectionPollingPaused,
  publishComposeSelection,
  subscribeImmediateComposeSelectionPoll,
} from "./composeSelectionStore";
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
// Observability watchdog only. Classic Outlook Win32 was seen (ERMAIN-431)
// dropping `getSelectedDataAsync` callbacks entirely; this makes a wedge
// visible in the console rather than a silent no-update. It no longer drives
// any state change (the old Text→Html switch is gone — see below).
const POLL_CALLBACK_TIMEOUT_MS = 5000;
// A call whose callback never fired holds the host's serialized item-API slot.
// After this long, stop waiting and let a fresh poll through; the stuck call's
// late callback is dropped by the sequence check. Kept short (Html coercion
// does NOT hang on the affected host, so this is a pure defensive backstop —
// the 30s value it replaced was what created the post-insert dead window).
const POLL_STALE_CALL_MS = 8_000;
// Grace period before clearing the selection when the mail item momentarily
// disappears. In reply / inline-compose contexts `Office.context.mailbox.item`
// (and the provider's `mailItem`) flap to null for a beat; clearing on the spot
// made the selection chip flicker. We hold the last selection and only clear if
// the item is still gone — or has become a read item — after this window.
const NULL_GRACE_MS = 2500;

/**
 * Polls `getSelectedDataAsync` while in compose mode, providing reactive
 * selection state. This is the single source of truth for what the user has
 * selected in the Outlook compose window. Mount ONCE (in `AddinChatInput`);
 * other consumers read the shared snapshot via `useComposeSelectionSnapshot`,
 * so there is only ever one poller contending for the host API.
 *
 * Office.js has no selection-change events, so we poll on an interval.
 *
 * **Coercion (ERMAIN-431): always `Html`.** On classic Outlook Win32,
 * `getSelectedDataAsync(Text)` HANGS 15s+ when the selection is Word-generated
 * HTML (the host's html→text conversion chokes), while `Html` returns
 * instantly. Rather than race Text and recover from the hang (which created a
 * 5–30s blind window after every insert), we always read Html and extract the
 * plain text client-side with `htmlToPlainText` — the same conversion the old
 * fallback path already used, now the only path. Cost is ~80ms per CHANGED
 * selection (deduped on the raw payload); the reliability win is total.
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
  // In-flight guard state — must SURVIVE effect re-runs (the effect re-runs on
  // every `mailItem` identity churn). It tracks the HOST's serialized API slot,
  // which is global; a re-run must not double-issue while a call is pending.
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
      lastRawHtmlRef.current = null;
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
    }

    let cancelled = false;
    let lastLoggedErrorCode: number | undefined;

    const poll = () => {
      if (cancelled) return;
      // A compose write (insert/replace) is holding the serialized item-API
      // slot; polling now would only contend (5100/5001). The write requests
      // an immediate poll when it completes.
      if (isComposeSelectionPollingPaused()) return;

      const composeItem = Office.context.mailbox
        .item as Office.MessageCompose | null;
      if (!composeItem) return;

      if (inFlightSeqRef.current !== null) {
        // A call is still outstanding — issuing another risks 5100. Skip this
        // tick unless it is old enough to abandon (its late callback is then
        // ignored via the seq check).
        if (Date.now() - inFlightSinceRef.current < POLL_STALE_CALL_MS) {
          return;
        }
        console.warn(
          `[selection-poll] abandoning a getSelectedDataAsync call stuck for ${POLL_STALE_CALL_MS}ms; a late callback will be ignored`,
        );
        inFlightSeqRef.current = null;
      }

      callSeqRef.current += 1;
      const seq = callSeqRef.current;
      inFlightSeqRef.current = seq;
      inFlightSinceRef.current = Date.now();

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
      }, POLL_CALLBACK_TIMEOUT_MS);

      composeItem.getSelectedDataAsync(
        Office.CoercionType.Html,
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
            const raw: string = result.value?.data ?? "";
            const sourceProperty: "body" | "subject" =
              result.value?.sourceProperty === "subject" ? "subject" : "body";

            // Dedup on the raw Html payload so the ~80ms extraction runs only
            // when the selection actually changed.
            if (
              raw === lastRawHtmlRef.current &&
              sourceProperty === lastSourceRef.current
            ) {
              return;
            }
            lastRawHtmlRef.current = raw;
            const data = raw.length > 0 ? htmlToPlainText(raw) : "";

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

    // Initial poll immediately, then on interval. Also poll on demand right
    // after a compose write, so a post-insert re-selection is picked up without
    // waiting up to a full interval.
    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    const unsubscribeImmediate = subscribeImmediateComposeSelectionPoll(poll);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      unsubscribeImmediate();
    };
  }, [mailItem]);

  return selection;
}
