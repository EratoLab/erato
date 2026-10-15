import {
  acceptedWordCommentSubmission,
  acceptedWordPlanFromHistory,
} from "@erato/frontend/word-review";

import {
  extractProposedClientAction,
  offerableWordClientActionsForFacet,
  WORD_COMMENT_CARD_FENCES,
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
  WORD_REPLACE_FENCE,
} from "./wordClientActions";
import { WORD_SUBMIT_PLAN_ACTION } from "./wordDocumentSubmission";

import type { ContentPart, HostArtifact } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

export const WORD_CARD_FENCE_LANGUAGES: readonly string[] = [
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
  WORD_REPLACE_FENCE,
  ...Object.values(WORD_COMMENT_CARD_FENCES),
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
  const offerable = offerableWordClientActionsForFacet(
    args.facetId,
    allowedClientActions,
  );
  if (!args.facetId || offerable.length === 0) return undefined;
  const plan = offerable.includes(WORD_SUBMIT_PLAN_ACTION)
    ? acceptedWordPlanFromHistory(args.content)
    : undefined;
  // A comment card exists only for a submission the host accepted; its draft_id names the card.
  const comments = plan
    ? undefined
    : acceptedWordCommentSubmission(args.content);
  const commentCard =
    comments && offerable.includes(comments.action) ? comments : undefined;
  const submitted = plan
    ? { ...plan, language: WORD_PLAN_FENCE }
    : commentCard
      ? {
          toolCallId: commentCard.toolCallId,
          content: commentCard.toolCallId,
          language: WORD_COMMENT_CARD_FENCES[commentCard.action],
        }
      : undefined;
  const proposedClientAction = plan
    ? WORD_SUBMIT_PLAN_ACTION
    : commentCard
      ? commentCard.action
      : allowedClientActions
        ? extractProposedClientAction(args.content, allowedClientActions)
        : undefined;
  return {
    facetId: args.facetId,
    renderMode: "suggestions",
    cardFenceLanguages: WORD_CARD_FENCE_LANGUAGES,
    ...(submitted
      ? {
          submittedCard: {
            toolCallId: submitted.toolCallId,
            content: submitted.content,
            language: submitted.language,
          },
        }
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
