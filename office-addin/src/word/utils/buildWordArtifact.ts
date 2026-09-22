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

export const WORD_CARD_FENCE_LANGUAGES: readonly string[] = [
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
];

/** Historical cards can render without a capture, but only an owned live capture permits writing. */
export function buildWordArtifact(args: {
  facetId: string | undefined;
  clientActionInfo:
    | {
        clientActions: string[];
        alwaysAskActions: string[];
        presentation?: string;
      }
    | undefined;
  content: ContentPart[] | undefined;
  messageId: string;
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
