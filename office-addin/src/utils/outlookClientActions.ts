import { t } from "@lingui/core/macro";

import type { ContentPart } from "@erato/frontend/library";

/**
 * Id of the config-defined action facet (erato.toml only) that lets the model
 * draft a reply to the email the user is currently reading and propose
 * opening Outlook's reply / reply-all form.
 */
export const OUTLOOK_REPLY_FROM_READ_FACET_ID = "outlook_reply_from_read";

/**
 * Name of the backend's synthetic tool through which the model proposes a
 * client action. Must match `CLIENT_ACTION_TOOL_NAME` in the backend.
 */
export const CLIENT_ACTION_TOOL_NAME = "propose_client_action";

/**
 * Client actions this add-in implements. A fixed, code-defined allowlist —
 * never extended at runtime. Anything the model (or backend config) proposes
 * outside this list is ignored.
 */
export const IMPLEMENTED_CLIENT_ACTIONS = [
  "outlook.reply",
  "outlook.reply_all",
] as const;

export type OutlookClientAction = (typeof IMPLEMENTED_CLIENT_ACTIONS)[number];

export function isImplementedClientAction(
  action: string,
): action is OutlookClientAction {
  return (IMPLEMENTED_CLIENT_ACTIONS as readonly string[]).includes(action);
}

/**
 * Human-readable description of an action, shared by the permission card
 * payload and the settings decision toggles.
 */
export function clientActionDisplayLabel(action: OutlookClientAction): string {
  return action === "outlook.reply_all"
    ? t({
        id: "officeAddin.clientActions.replyAll",
        message: "Reply to all recipients",
      })
    : t({
        id: "officeAddin.clientActions.reply",
        message: "Reply to sender",
      });
}

/**
 * The client actions the renderer may offer for a message: the facet's
 * backend-advertised `client_actions`, intersected with what this add-in
 * implements, in the fixed registry order.
 */
export function offerableClientActions(
  allowedActions: readonly string[] | undefined,
): OutlookClientAction[] {
  if (!allowedActions || allowedActions.length === 0) {
    return [];
  }
  return IMPLEMENTED_CLIENT_ACTIONS.filter((action) =>
    allowedActions.includes(action),
  );
}

/**
 * Extract the model's validated client-action proposal from an assistant
 * message's content parts.
 *
 * The proposal is only accepted when ALL of the following hold — anything
 * else returns `undefined` (render plain buttons, never "best effort"):
 * - a `propose_client_action` tool_use part exists with status `"success"`
 *   (the backend already validated the input against the facet's enum),
 * - its `input.action` is a string,
 * - the action is in `allowedActions` (the facet's `client_actions` from
 *   `GET /me/facets` — revalidated here, never trusted from message text),
 * - the action is implemented by this add-in.
 */
export function extractProposedClientAction(
  content: ContentPart[] | undefined,
  allowedActions: readonly string[],
): OutlookClientAction | undefined {
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
    if (isImplementedClientAction(action)) {
      return action;
    }
  }
  return undefined;
}

/**
 * Producer-side verdict for {@link OutlookArtifact.shouldRenderEmailCard}:
 * whether an UNFENCED, `"body"`-mode response should render as the insertable
 * email card. A facet that OFFERS client actions (reply / reply-all) is
 * attached ambiently to every read-mode message, so a plain answer with no
 * proposal must NOT card; a facet with no offerable actions — compose /
 * rewrite-selection, or a facet advertising ONLY actions this add-in does not
 * implement — always cards. Keyed off the OFFERABLE set (`allowedClientActions`
 * intersected with the implemented registry) so the carding verdict matches
 * what the renderer can actually act on. A fenced draft never reaches this
 * verdict; the renderer's fence path handles it.
 */
export function computeShouldRenderEmailCard(args: {
  allowedClientActions: readonly string[] | undefined;
  proposedClientAction: string | undefined;
}): boolean {
  const isClientActionFacet =
    offerableClientActions(args.allowedClientActions).length > 0;
  return !isClientActionFacet || args.proposedClientAction != null;
}
