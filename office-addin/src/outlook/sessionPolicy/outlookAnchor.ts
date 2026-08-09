import type { OutlookSessionAnchor, OutlookSessionPreferences } from "./types";

/**
 * Type-guard for read-mode messages using the only synchronously-available
 * property that distinguishes the surfaces: `subject` is a `string` on
 * `MessageRead` and a subject accessor object on every compose surface
 * (message and appointment alike), so this returns `false` for both compose
 * modes.
 *
 * Pure; safe to call during render or in a `useState` initializer.
 */
export function isMessageRead(
  item: SupportedOutlookItem,
): item is Office.MessageRead {
  return typeof (item as Office.MessageRead).subject === "string";
}

export type SupportedOutlookItem =
  | Office.MessageRead
  | Office.MessageCompose
  | Office.AppointmentCompose;

export const UNSAVED_COMPOSE_IDENTITY_PREFIX = "compose:";
export const UNSAVED_APPOINTMENT_IDENTITY_PREFIX = "appointment:";

const mintedItemIdentities = new WeakMap<object, string>();

/**
 * Page-load-scoped identity for compose surfaces that expose no durable id
 * (unsaved appointment/message composes). Keyed on the host's item object, so
 * repeated resolves of the same object agree; a reload (or a host that hands
 * out a fresh object) mints a new identity, which fails toward "different
 * item" — the safe direction for the anchor policy and the insert guard.
 *
 * Idempotent per item object; safe to call during render.
 */
export function getOrMintItemIdentity(item: object, prefix: string): string {
  const existing = mintedItemIdentities.get(item);
  if (existing) return existing;
  const identity = `${prefix}${globalThis.crypto.randomUUID()}`;
  mintedItemIdentities.set(item, identity);
  return identity;
}

export function isAppointmentCompose(
  item: SupportedOutlookItem,
): item is Office.AppointmentCompose {
  return (
    String((item as { itemType?: string }).itemType).toLowerCase() ===
      "appointment" &&
    typeof (item as unknown as { subject?: unknown }).subject !== "string"
  );
}

/**
 * Narrow a raw `Office.context.mailbox.item` to the surfaces the add-in
 * supports. Organizer appointment compose is supported; attendee/read mode is
 * deliberately rejected so it can never masquerade as a read email. An absent
 * `itemType` keeps meaning "message" because mocks and some hosts omit it.
 *
 * Pure; safe to call during render or in a `useState` initializer.
 */
export function resolveSupportedMailboxItem(
  item: unknown,
): SupportedOutlookItem | null {
  if (!item) return null;

  const candidate = item as SupportedOutlookItem;
  const isAppointment =
    String((candidate as { itemType?: string }).itemType).toLowerCase() ===
    "appointment";
  if (isAppointment && !isAppointmentCompose(candidate)) return null;

  return candidate;
}

/**
 * Build an `OutlookSessionAnchor` from a raw Office mailbox item. Pure — the
 * caller is responsible for resolving `Office.context.mailbox?.item` and
 * handling any access errors. Returns `null` for a missing item.
 *
 * Pure; safe to call during render or in a `useState` initializer.
 */
export function outlookAnchorFromItem(
  item: SupportedOutlookItem | null,
): OutlookSessionAnchor | null {
  if (!item) return null;
  if (isAppointmentCompose(item)) {
    // Deliberately NOT `seriesId`: Office.js reports the PARENT series id on
    // every occurrence of a recurring series, so two different occurrences
    // would share an anchor (and a chat, and the insert gate). The minted
    // identity is page-load-scoped — appointment chats never resume across a
    // task-pane reload, exactly like a brand-new message compose.
    return {
      conversationId: null,
      isCompose: true,
      itemKind: "appointment",
      itemIdentity: getOrMintItemIdentity(
        item,
        UNSAVED_APPOINTMENT_IDENTITY_PREFIX,
      ),
    };
  }
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
  const aKind = a.itemKind ?? "message";
  const bKind = b.itemKind ?? "message";
  if (aKind !== bKind) return false;
  if (aKind === "appointment") {
    if (!a.itemIdentity || !b.itemIdentity) return false;
    return a.itemIdentity === b.itemIdentity && a.isCompose === b.isCompose;
  }
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
  if (
    (a.itemKind ?? "message") !== "message" ||
    (b.itemKind ?? "message") !== "message"
  ) {
    return false;
  }
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
