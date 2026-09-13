import { useMemo } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { outlookAnchorFromSelectedConversation } from "../sessionPolicy";

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
 * context yet). With no single item — a collapsed conversation header selects
 * every message in the stack, so the host reports no `mailbox.item` — the
 * anchor is derived from the summarised selection instead; `null` only when
 * neither is available.
 */
export function useOutlookSessionAnchor(): OutlookSessionAnchor | null {
  const { itemIdentity, mailItem, selectedConversation, isLoading } =
    useOutlookMailItem();

  const liveAnchor = useMemo<OutlookSessionAnchor | null>(() => {
    if (isLoading) return null;
    if (!mailItem) {
      return selectedConversation
        ? outlookAnchorFromSelectedConversation(selectedConversation)
        : null;
    }
    return {
      conversationId: mailItem.conversationId,
      isCompose: mailItem.isComposeMode,
      itemKind: mailItem.itemKind,
      itemIdentity:
        mailItem.itemKind === "appointment" ? itemIdentity : undefined,
    };
  }, [isLoading, itemIdentity, mailItem, selectedConversation]);

  // Leading-edge: the first observation passes through without waiting, so
  // cold-open lands the anchor instantly and the session policy can fire
  // before the chat UI flashes the previous chat. Subsequent `ItemChanged`
  // bursts (inbox sweeping) still collapse trailing-edge.
  return useDebouncedValue(liveAnchor, ANCHOR_DEBOUNCE_MS, { leading: true });
}
