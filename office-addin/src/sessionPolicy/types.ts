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
