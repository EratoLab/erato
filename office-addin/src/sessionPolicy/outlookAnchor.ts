import type { OutlookSessionAnchor, OutlookSessionPreferences } from "./types";

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
