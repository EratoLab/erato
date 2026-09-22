import {
  extractProposedClientAction,
  offerableWordClientActionsForFacet,
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
} from "./wordClientActions";
import {
  acceptedWordDocumentSubmission,
  WORD_SUBMIT_PLAN_ACTION,
} from "./wordDocumentSubmission";

import type { WordDocumentCapture } from "./wordDocumentCapture";
import type { ContentPart, HostArtifact } from "@erato/frontend/library";

/**
 * Case-sensitive languages registered with HostArtifact.cardFenceLanguages.
 * The shared renderer needs these tags to display Word review cards.
 */
export const WORD_CARD_FENCE_LANGUAGES: readonly string[] = [
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
];

/**
 * Build an artifact for a facet advertising actions supported by this pane.
 * An accepted submission supplies submittedCard; action fences remain supported.
 *
 * Suggestions mode keeps assistant prose outside the review card. Freshness
 * and document identity come from the session capture, so historical messages
 * without that capture cannot enable Apply after a pane reload.
 */
export function buildWordArtifact(args: {
  facetId: string | undefined;
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
  /** The send-time capture paired with this message, if this pane has it. */
  capture: WordDocumentCapture | undefined;
}): HostArtifact | undefined {
  const allowedClientActions = args.clientActionInfo?.clientActions;
  if (
    !args.facetId ||
    offerableWordClientActionsForFacet(args.facetId, allowedClientActions)
      .length === 0
  ) {
    return undefined;
  }
  // Only successful proposals or accepted submission receipts, revalidated
  // against the advertised action set — never inferred from assistant prose.
  const submitted = offerableWordClientActionsForFacet(
    args.facetId,
    allowedClientActions,
  ).includes(WORD_SUBMIT_PLAN_ACTION)
    ? acceptedWordDocumentSubmission(args.content)
    : undefined;
  const proposedClientAction = submitted
    ? WORD_SUBMIT_PLAN_ACTION
    : allowedClientActions
      ? extractProposedClientAction(args.content, allowedClientActions)
      : undefined;
  return {
    facetId: args.facetId,
    renderMode: "suggestions",
    cardFenceLanguages: WORD_CARD_FENCE_LANGUAGES,
    ...(submitted
      ? { submittedCard: { ...submitted, language: WORD_PLAN_FENCE } }
      : {}),
    messageId: args.messageId,
    ...(allowedClientActions ? { allowedClientActions } : {}),
    ...(args.clientActionInfo &&
    args.clientActionInfo.alwaysAskActions.length > 0
      ? { alwaysAskClientActions: args.clientActionInfo.alwaysAskActions }
      : {}),
    ...(proposedClientAction ? { proposedClientAction } : {}),
    ...(args.clientActionInfo?.presentation
      ? { clientActionPresentation: args.clientActionInfo.presentation }
      : {}),
    ...(args.capture
      ? { isFreshCompletion: true, itemIdentity: args.capture.identity }
      : {}),
  };
}
