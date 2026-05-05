/**
 * Behaviour modes for an Office add-in's chat-session lifecycle. The mode
 * describes what should happen when the add-in's "context" changes — either at
 * cold-open (a different document/mail than the one the chat was anchored to)
 * or while the taskpane is open (the user navigates to a new document/mail).
 *
 * - `resume`: silently re-open the previously active chat. Default.
 * - `ask`: prompt the user (via toast) whether to continue or start fresh.
 * - `new`: silently start a new chat.
 */
export type AddinSessionMode = "resume" | "ask" | "new";

/** What just happened, from the policy's point of view. */
export type AddinSessionTrigger<TAnchor> =
  | { kind: "cold-open" }
  | {
      kind: "context-change";
      previous: TAnchor | null;
      next: TAnchor | null;
    };

/**
 * The action the provider should take next. The provider applies the side
 * effect — none of the action values cause anything on their own.
 */
export type AddinSessionAction =
  | { kind: "resume"; chatId: string }
  | { kind: "new" }
  | { kind: "ask"; suggestedChatId: string | null };

export interface AddinSessionState<TAnchor> {
  chatId: string | null;
  anchor: TAnchor | null;
}

export interface AddinSessionPolicy {
  mode: AddinSessionMode;
}

export interface AddinSessionActionInput<TAnchor> {
  trigger: AddinSessionTrigger<TAnchor>;
  saved: AddinSessionState<TAnchor>;
  /**
   * The current anchor (i.e. what document/mail the user is on right now).
   * `null` when the host has no addressable context yet (e.g. Outlook still
   * loading the item).
   */
  currentAnchor: TAnchor | null;
  policy: AddinSessionPolicy;
  /**
   * Equality between two anchors. Hosts encode their host-specific rules here
   * (e.g. "compose-of-the-same-conversation counts as the same anchor as the
   * read mail it derives from").
   */
  anchorsEqual: (a: TAnchor | null, b: TAnchor | null) => boolean;
}
