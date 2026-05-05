import type {
  AddinSessionAction,
  AddinSessionActionInput,
} from "./types";

/**
 * Pure policy resolver for the add-in chat-session lifecycle. Given a trigger,
 * the saved state, the current host context, and the user's policy
 * preferences, returns one of `{resume, new, ask}` — the action the provider
 * should take.
 *
 * Host-agnostic: the anchor type and equality function are supplied by the
 * caller so each host (Outlook, Excel, Word, …) can encode its own rules
 * without this module needing to know about Office concepts.
 *
 * No side effects, no React, no DOM. Trivially unit-testable.
 */
export function selectAddinSessionAction<TAnchor>(
  input: AddinSessionActionInput<TAnchor>,
): AddinSessionAction {
  const { saved, currentAnchor, policy, anchorsEqual } = input;

  // Anchors match → there is no context change to react to. Always resume the
  // saved chat (or start fresh if there is none), regardless of mode.
  const sameContext = anchorsEqual(saved.anchor, currentAnchor);
  if (sameContext) {
    return saved.chatId
      ? { kind: "resume", chatId: saved.chatId }
      : { kind: "new" };
  }

  // From here on the context has actually changed.
  switch (policy.mode) {
    case "resume":
      return saved.chatId
        ? { kind: "resume", chatId: saved.chatId }
        : { kind: "new" };
    case "new":
      return { kind: "new" };
    case "ask":
      // On the very first cold-open with nothing saved, there is nothing to
      // ask about — just start fresh. The toast only makes sense when there
      // is a prior chat the user might want to continue.
      if (!saved.chatId) {
        return { kind: "new" };
      }
      // On a context-change where the previous anchor was null (taskpane just
      // opened, no prior context observed), treat it like a cold-open with
      // saved state: still worth asking, but a sensible default exists.
      return { kind: "ask", suggestedChatId: saved.chatId };
    default: {
      const exhaustive: never = policy.mode;
      throw new Error(`Unhandled session mode: ${String(exhaustive)}`);
    }
  }
}
