import type { ContentPart } from "@erato/frontend/library";

/** Must match the backend tool name. */
export const CLIENT_ACTION_TOOL_NAME = "propose_client_action";

/** Require a successful backend proposal and intersect configured and implemented actions.
 * Assistant prose cannot authorize a write. */
export function extractProposedClientAction<TAction extends string>(
  content: ContentPart[] | undefined,
  allowedActions: readonly string[],
  isImplementedAction: (action: string) => action is TAction,
): TAction | undefined {
  for (const part of content ?? []) {
    if (part.content_type !== "tool_use") {
      continue;
    }
    if (part.tool_name !== CLIENT_ACTION_TOOL_NAME) {
      continue;
    }
    if (part.status !== "success") {
      continue;
    }
    const input: unknown = part.input;
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      continue;
    }
    const action = (input as Record<string, unknown>).action;
    if (typeof action !== "string") {
      continue;
    }
    if (!allowedActions.includes(action)) {
      continue;
    }
    if (isImplementedAction(action)) {
      return action;
    }
  }
  return undefined;
}
