/**
 * Anchor identifying the user's current Outlook context. The chat-session
 * policy uses this to decide whether the user has switched conversations.
 *
 * `conversationId` is the Outlook thread id (shared by all read items in a
 * thread, and inherited by Reply/Forward composes before they're saved). For
 * brand-new composes with no thread, it is `null` — those are always treated
 * as a distinct context.
 */
export interface OutlookSessionAnchor {
  conversationId: string | null;
  isCompose: boolean;
  /** Defaults to `message` for anchors persisted by older add-in builds. */
  itemKind?: "message" | "appointment";
  /**
   * Minted identity for appointment composes, which have no durable id before
   * save (`seriesId` is unusable — it names the whole recurring series, not
   * the occurrence). Page-load-scoped: a persisted appointment anchor never
   * matches after a task-pane reload, so appointment chats don't resume
   * across reloads by design.
   */
  itemIdentity?: string | null;
}

export interface OutlookSessionPreferences {
  /** Top-level mode: how to react to context changes. */
  mode: "resume" | "ask" | "new";
  /**
   * When true, a compose item that derives from the same thread as the most
   * recent read mail is treated as the *same* anchor (i.e. the chat carries
   * over). When false, switching to compose is a context change like any
   * other.
   */
  composeInheritsFromRead: boolean;
}

export const DEFAULT_OUTLOOK_SESSION_PREFERENCES: OutlookSessionPreferences = {
  mode: "resume",
  composeInheritsFromRead: true,
};

export function getDefaultOutlookSessionPreferences(): OutlookSessionPreferences {
  const configured = window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  return {
    mode:
      configured?.mode === "ask" || configured?.mode === "new"
        ? configured.mode
        : "resume",
    composeInheritsFromRead:
      configured?.compose_inherits_from_read ??
      DEFAULT_OUTLOOK_SESSION_PREFERENCES.composeInheritsFromRead,
  };
}
