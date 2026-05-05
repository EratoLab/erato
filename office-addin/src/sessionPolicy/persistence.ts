import {
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  type OutlookSessionAnchor,
  type OutlookSessionPreferences,
} from "./types";

import type { PersistedStateOptions } from "@erato/frontend/library";

export const OUTLOOK_SESSION_KEY = "erato.outlookAddin.session";
export const OUTLOOK_SESSION_PREFERENCES_KEY =
  "erato.outlookAddin.sessionPreferences";

/** Pre-versioned key written by older builds. We migrate it on first read. */
export const LEGACY_CHAT_ID_KEY = "erato-office-addin-current-chat-id";

export interface OutlookSessionStorageValue {
  chatId: string | null;
  anchor: OutlookSessionAnchor | null;
}

const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isAnchor = (value: unknown): value is OutlookSessionAnchor => {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isStringOrNull(candidate.conversationId) &&
    typeof candidate.isCompose === "boolean"
  );
};

const isAnchorOrNull = (value: unknown): value is OutlookSessionAnchor | null =>
  value === null || isAnchor(value);

export const outlookSessionPersistedOptions: PersistedStateOptions<OutlookSessionStorageValue> =
  {
    parse: (value) => {
      if (value === null || typeof value !== "object") return null;
      const candidate = value as Record<string, unknown>;
      if (!isStringOrNull(candidate.chatId)) return null;
      if (!isAnchorOrNull(candidate.anchor)) return null;
      return {
        chatId: candidate.chatId,
        anchor: candidate.anchor,
      };
    },
  };

const isMode = (value: unknown): value is OutlookSessionPreferences["mode"] =>
  value === "resume" || value === "ask" || value === "new";

export const outlookSessionPreferencesPersistedOptions: PersistedStateOptions<OutlookSessionPreferences> =
  {
    parse: (value) => {
      if (value === null || typeof value !== "object") return null;
      const candidate = value as Record<string, unknown>;
      if (!isMode(candidate.mode)) return null;
      if (typeof candidate.composeInheritsFromRead !== "boolean") return null;
      return {
        mode: candidate.mode,
        composeInheritsFromRead: candidate.composeInheritsFromRead,
      };
    },
  };

/**
 * One-shot migration of the legacy `erato-office-addin-current-chat-id` key
 * (a bare string) into the new shape. Idempotent — safe to call on every
 * cold open.
 */
export function migrateLegacyChatIdKey(): void {
  try {
    const legacyValue = localStorage.getItem(LEGACY_CHAT_ID_KEY);
    if (legacyValue === null) return;

    const alreadyMigrated = localStorage.getItem(OUTLOOK_SESSION_KEY);
    if (alreadyMigrated === null) {
      const value: OutlookSessionStorageValue = {
        chatId: legacyValue,
        anchor: null,
      };
      localStorage.setItem(OUTLOOK_SESSION_KEY, JSON.stringify(value));
    }
    localStorage.removeItem(LEGACY_CHAT_ID_KEY);
  } catch {
    // Best-effort migration; falling back to defaults is acceptable.
  }
}

export const DEFAULT_OUTLOOK_SESSION: OutlookSessionStorageValue = {
  chatId: null,
  anchor: null,
};

export { DEFAULT_OUTLOOK_SESSION_PREFERENCES };
