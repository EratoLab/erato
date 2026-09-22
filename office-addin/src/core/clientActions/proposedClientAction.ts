import type { ContentPart } from "@erato/frontend/library";

/**
 * Name of the backend's synthetic tool through which the model proposes a
 * client action. Must match `CLIENT_ACTION_TOOL_NAME` in the backend.
 */
export const CLIENT_ACTION_TOOL_NAME = "propose_client_action";

/**
 * Extract the model's validated client-action proposal from an assistant
 * message's content parts.
 *
 * Host-neutral: every gate below is a property of the backend's proposal
 * contract, not of any one host. The single host-specific step — "is this
 * action implemented by this build?" — arrives as `isImplementedAction`, the
 * same predicate family the decision store is built from
 * (`ImplementedActionPredicate` in `./clientActionPolicy`). Passing a type
 * guard narrows the return type to the host's action union, so a host binding
 * needs no cast.
 *
 * The proposal is only accepted when ALL of the following hold — anything
 * else returns `undefined` (render plain buttons, never "best effort"):
 * - a `propose_client_action` tool_use part exists with status `"success"`
 *   (the backend already validated the input against the facet's enum),
 * - its `input.action` is a string,
 * - the action is in `allowedActions` (the facet's `client_actions` from
 *   `GET /me/facets` — revalidated here, never trusted from message text),
 * - the action is implemented by this add-in.
 *
 * No host should re-implement this validator: the advertised-set check is the
 * security-relevant half, and divergence between hosts is what this exists to
 * prevent (the backend independently rejects an out-of-enum proposal).
 */
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
