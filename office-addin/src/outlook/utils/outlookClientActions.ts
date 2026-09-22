import { t } from "@lingui/core/macro";

import { extractProposedClientAction as extractProposedClientActionFor } from "../../core/clientActions/proposedClientAction";

import type { ContentPart, HostArtifact } from "@erato/frontend/library";

export { CLIENT_ACTION_TOOL_NAME } from "../../core/clientActions/proposedClientAction";

/**
 * Id of the config-defined action facet (erato.toml only) that lets the model
 * draft a reply to the email the user is currently reading and propose
 * opening Outlook's reply / reply-all form.
 */
export const OUTLOOK_REPLY_FROM_READ_FACET_ID = "outlook_reply_from_read";

/**
 * Actions whose payload is the message's email draft — executed by the
 * erato-email renderer via Outlook's reply forms.
 */
export const EMAIL_CLIENT_ACTIONS = [
  "outlook.reply",
  "outlook.reply_all",
] as const;

export type OutlookEmailClientAction = (typeof EMAIL_CLIENT_ACTIONS)[number];

/**
 * Actions whose payload is the message's `erato-appointment` fence — executed
 * by the appointment renderer via Outlook's new-appointment form.
 */
export const APPOINTMENT_CLIENT_ACTIONS = [
  "outlook.create_appointment",
] as const;

export type OutlookAppointmentClientAction =
  (typeof APPOINTMENT_CLIENT_ACTIONS)[number];

/**
 * Client actions this add-in implements. A fixed, code-defined allowlist —
 * never extended at runtime. Anything the model (or backend config) proposes
 * outside this list is ignored. Partitioned by KIND (email vs appointment):
 * each renderer only offers and executes its own kind, so a facet advertising
 * `outlook.create_appointment` can never surface a reply button (or vice
 * versa).
 */
export const IMPLEMENTED_CLIENT_ACTIONS = [
  ...EMAIL_CLIENT_ACTIONS,
  ...APPOINTMENT_CLIENT_ACTIONS,
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
  switch (action) {
    case "outlook.reply_all":
      return t({
        id: "officeAddin.clientActions.replyAll",
        message: "Reply to all recipients",
      });
    case "outlook.create_appointment":
      return t({
        id: "officeAddin.clientActions.createAppointment",
        message: "Open a prefilled appointment",
      });
    case "outlook.reply":
      return t({
        id: "officeAddin.clientActions.reply",
        message: "Reply to sender",
      });
  }
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

/** {@link offerableClientActions} restricted to the email kind. */
export function offerableEmailClientActions(
  allowedActions: readonly string[] | undefined,
): OutlookEmailClientAction[] {
  return EMAIL_CLIENT_ACTIONS.filter((action) =>
    (allowedActions ?? []).includes(action),
  );
}

/** {@link offerableClientActions} restricted to the appointment kind. */
export function offerableAppointmentClientActions(
  allowedActions: readonly string[] | undefined,
): OutlookAppointmentClientAction[] {
  return APPOINTMENT_CLIENT_ACTIONS.filter((action) =>
    (allowedActions ?? []).includes(action),
  );
}

/**
 * The Outlook binding of the host-neutral proposal validator: Outlook's
 * action registry is what decides whether a backend-advertised action is one
 * this build can execute. Everything else about the validation lives in
 * `core/clientActions/proposedClientAction.ts`.
 */
export function extractProposedClientAction(
  content: ContentPart[] | undefined,
  allowedActions: readonly string[],
): OutlookClientAction | undefined {
  return extractProposedClientActionFor(
    content,
    allowedActions,
    isImplementedClientAction,
  );
}

/**
 * Producer-side verdict for {@link HostArtifact.shouldRenderEmailCard}:
 * whether an UNFENCED, `"body"`-mode response should render as the insertable
 * email card. A facet that OFFERS email client actions (reply / reply-all) is
 * attached ambiently to every read-mode message, so a plain answer with no
 * proposal must NOT card; a facet with no offerable email actions — compose /
 * rewrite-selection, or a facet advertising ONLY actions this add-in does not
 * implement — always cards. Keyed off the OFFERABLE set (`allowedClientActions`
 * intersected with the implemented registry) so the carding verdict matches
 * what the renderer can actually act on, and restricted to the EMAIL kind: an
 * appointment proposal is not an email draft and must never promote prose to
 * an email card. A fenced draft never reaches this verdict; the renderer's
 * fence path handles it. (The verdict is only consumed for email-bodied
 * facets at all — the whole-body fallback additionally requires a
 * `bodyFormat`.)
 */
export function computeShouldRenderEmailCard(args: {
  allowedClientActions: readonly string[] | undefined;
  proposedClientAction: string | undefined;
}): boolean {
  const emailActions = offerableEmailClientActions(args.allowedClientActions);
  const proposedEmailAction =
    args.proposedClientAction != null &&
    (emailActions as readonly string[]).includes(args.proposedClientAction);
  return emailActions.length === 0 || proposedEmailAction;
}

/**
 * Build the `hostArtifact` stamp for one assistant message, or `undefined`
 * when the producing facet doesn't render through the artifact machinery.
 *
 * A message qualifies through EITHER door:
 * - the facet carried a `body_format` arg (`"text"`/`"html"`) — its output is
 *   an insertable email body (compose / rewrite / reply / review facets), or
 * - the facet advertises client actions this add-in implements — its output
 *   carries an actionable proposal even without an email body (e.g. the
 *   scheduling facet's `erato-appointment` fence).
 *
 * `bodyFormat` is stamped only from the first door: its presence is what
 * unlocks the email-shaped rendering paths (drifted-tag rescue, whole-body
 * card), which must stay off for action-fence facets.
 */
export function buildOutlookArtifact(args: {
  facetId: string | undefined;
  facetArgs: Record<string, string> | undefined;
  /** The facet's entry from `GET /me/facets`, if it declares client actions. */
  clientActionInfo:
    | {
        clientActions: string[];
        alwaysAskActions: string[];
        presentation?: string;
      }
    | undefined;
  /** The assistant message's content parts (proposal extraction). */
  content: ContentPart[] | undefined;
  messageId: string;
  /**
   * Send-time item identity when this message is a FRESH completion whose
   * identity is known; `undefined` otherwise (history and identity-unknown
   * completions render as history-like drafts).
   */
  freshItemIdentity: string | undefined;
}): HostArtifact | undefined {
  const bodyFormatArg = args.facetArgs?.body_format;
  const bodyFormat =
    bodyFormatArg === "text" || bodyFormatArg === "html"
      ? bodyFormatArg
      : undefined;
  const allowedClientActions = args.clientActionInfo?.clientActions;
  const hasOfferableActions =
    offerableClientActions(allowedClientActions).length > 0;
  if (!args.facetId || (bodyFormat === undefined && !hasOfferableActions)) {
    return undefined;
  }
  const renderMode =
    args.facetId === "outlook_review_draft" ? "suggestions" : "body";
  // The model's proposal is only stamped after revalidation against the
  // backend-advertised set + tool-call status — never parsed out of message
  // text.
  const proposedClientAction = allowedClientActions
    ? extractProposedClientAction(args.content, allowedClientActions)
    : undefined;
  // Single source of truth for carding (see HostArtifact.shouldRenderEmailCard).
  // Stamped below only when it SUPPRESSES (false); absent ⇒ cards.
  const shouldRenderEmailCard = computeShouldRenderEmailCard({
    allowedClientActions,
    proposedClientAction,
  });
  return {
    facetId: args.facetId,
    ...(bodyFormat ? { bodyFormat } : {}),
    renderMode,
    messageId: args.messageId,
    ...(allowedClientActions ? { allowedClientActions } : {}),
    ...(renderMode === "body" && !shouldRenderEmailCard
      ? { shouldRenderEmailCard: false }
      : {}),
    ...(args.clientActionInfo &&
    args.clientActionInfo.alwaysAskActions.length > 0
      ? { alwaysAskClientActions: args.clientActionInfo.alwaysAskActions }
      : {}),
    ...(proposedClientAction ? { proposedClientAction } : {}),
    ...(args.clientActionInfo?.presentation
      ? { clientActionPresentation: args.clientActionInfo.presentation }
      : {}),
    ...(args.freshItemIdentity !== undefined
      ? { isFreshCompletion: true, itemIdentity: args.freshItemIdentity }
      : {}),
  };
}
