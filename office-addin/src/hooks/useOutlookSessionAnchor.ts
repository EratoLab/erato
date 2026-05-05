import { useMemo } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";

import type { OutlookSessionAnchor } from "../sessionPolicy";

const ANCHOR_DEBOUNCE_MS = 400;

/**
 * Reads the current Outlook item from `OutlookMailItemProvider` and exposes it
 * as an `OutlookSessionAnchor` — the shape consumed by the session policy.
 *
 * The returned anchor is debounced: rapid `ItemChanged` events (e.g. the user
 * sweeping through the inbox) collapse to a single update once the selection
 * has been stable for `ANCHOR_DEBOUNCE_MS`. This keeps the session policy
 * (and any "ask" toast it spawns) from firing on every flicker.
 *
 * Returns `null` while the item provider is still loading (no observable
 * context yet) or when no Outlook item is available.
 */
export function useOutlookSessionAnchor(): OutlookSessionAnchor | null {
  const { mailItem, isLoading } = useOutlookMailItem();

  const liveAnchor = useMemo<OutlookSessionAnchor | null>(() => {
    if (isLoading || !mailItem) return null;
    return {
      conversationId: mailItem.conversationId,
      isCompose: mailItem.isComposeMode,
    };
  }, [isLoading, mailItem]);

  // Leading-edge: the first observation passes through without waiting, so
  // cold-open lands the anchor instantly and the session policy can fire
  // before the chat UI flashes the previous chat. Subsequent `ItemChanged`
  // bursts (inbox sweeping) still collapse trailing-edge.
  return useDebouncedValue(liveAnchor, ANCHOR_DEBOUNCE_MS, { leading: true });
}
