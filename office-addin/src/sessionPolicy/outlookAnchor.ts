import type { OutlookSessionAnchor, OutlookSessionPreferences } from "./types";

/**
 * Type-guard distinguishing read mode from compose mode using the only
 * synchronously-available property of the compose surface that's a non-string
 * (`subject` is `Office.SubjectCompose` for compose, `string` for read).
 *
 * Pure; safe to call during render or in a `useState` initializer.
 */
export function isMessageRead(
  item: Office.MessageRead | Office.MessageCompose,
): item is Office.MessageRead {
  return typeof (item as Office.MessageRead).subject === "string";
}

/**
 * Build an `OutlookSessionAnchor` from a raw Office mailbox item. Pure — the
 * caller is responsible for resolving `Office.context.mailbox?.item` and
 * handling any access errors. Returns `null` for a missing item.
 *
 * Pure; safe to call during render or in a `useState` initializer.
 */
export function outlookAnchorFromItem(
  item: Office.MessageRead | Office.MessageCompose | null,
): OutlookSessionAnchor | null {
  if (!item) return null;
  return {
    conversationId: item.conversationId ?? null,
    isCompose: !isMessageRead(item),
  };
}

/**
 * Strict equality: same conversation, same mode (read vs. compose). Brand-new
 * composes have `conversationId === null` — null never equals null here, so a
 * fresh compose is always considered a new anchor.
 */
export function strictAnchorsEqual(
  a: OutlookSessionAnchor | null,
  b: OutlookSessionAnchor | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.conversationId === null || b.conversationId === null) return false;
  return a.conversationId === b.conversationId && a.isCompose === b.isCompose;
}

/**
 * Equality variant where a compose item is treated as the same anchor as the
 * read mail it derives from (same `conversationId`). Used when the user's
 * preference has `composeInheritsFromRead = true` — the typical case where
 * clicking Reply on the email you've been chatting about should keep the
 * chat alive.
 */
export function composeInheritsAnchorsEqual(
  a: OutlookSessionAnchor | null,
  b: OutlookSessionAnchor | null,
): boolean {
  if (strictAnchorsEqual(a, b)) return true;
  if (!a || !b) return false;
  if (a.conversationId === null || b.conversationId === null) return false;
  return a.conversationId === b.conversationId;
}

export function anchorsEqualForPreferences(
  preferences: OutlookSessionPreferences,
): (a: OutlookSessionAnchor | null, b: OutlookSessionAnchor | null) => boolean {
  return preferences.composeInheritsFromRead
    ? composeInheritsAnchorsEqual
    : strictAnchorsEqual;
}
