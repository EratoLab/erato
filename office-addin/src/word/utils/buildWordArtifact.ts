import {
  acceptedWordCommentSubmission,
  acceptedWordCommentSubmissions,
  acceptedWordPlanFromHistory,
  acceptedWordPlansFromHistory,
  WORD_PARTS_FENCE,
  wordPartsPlanningCall,
  wordPartsSectionPlanCall,
} from "@erato/frontend/word-review";

import { wordChainedApplyCallId } from "./wordChainedApply";
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
import { isProposalChained } from "../../core/clientActions/proposalApply";

import type {
  ContentPart,
  HostArtifact,
  HostSubmittedCard,
} from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

export const WORD_CARD_FENCE_LANGUAGES: readonly string[] = [
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
  WORD_PARTS_FENCE,
  WORD_REPLACE_FENCE,
  ...Object.values(WORD_COMMENT_CARD_FENCES),
];

/**
 * Every accepted change of an answer the server applied itself, each with its card, in call
 * order. Undefined when the server applied none: the answer then has today's one card.
 */
function chainedCards(
  content: ContentPart[] | undefined,
  offerable: readonly string[],
): HostSubmittedCard[] | undefined {
  const plans = offerable.includes(WORD_SUBMIT_PLAN_ACTION)
    ? acceptedWordPlansFromHistory(content).map((plan) => ({
        toolCallId: plan.toolCallId,
        content: plan.content,
        language: WORD_PLAN_FENCE,
      }))
    : [];
  const comments = acceptedWordCommentSubmissions(content)
    .filter((comment) => offerable.includes(comment.action))
    .map((comment) => ({
      toolCallId: comment.toolCallId,
      content: comment.toolCallId,
      language: WORD_COMMENT_CARD_FENCES[comment.action],
    }));
  const cards = [...plans, ...comments];
  if (!cards.some((card) => wordChainedApplyCallId(content, card.toolCallId)))
    return undefined;
  const order = new Map(
    (content ?? []).map((part, index) => [
      part.content_type === "tool_use" ? part.tool_call_id : undefined,
      index,
    ]),
  );
  return cards.sort(
    (a, b) => (order.get(a.toolCallId) ?? 0) - (order.get(b.toolCallId) ?? 0),
  );
}

/** Historical cards can render without a capture, but only an owned live capture permits writing. */
export function buildWordArtifact(args: {
  facetId: string | undefined;
  clientActionInfo:
    | {
        clientActions: string[];
        alwaysAskActions: string[];
        presentation?: string;
        grantScope?: Record<string, string>;
      }
    | undefined;
  content: ContentPart[] | undefined;
  messageId: string;
  capture: WordDocumentCapture | undefined;
  /** The message is still being written. */
  generating?: boolean;
}): HostArtifact | undefined {
  const allowedClientActions = args.clientActionInfo?.clientActions;
  const offerable = offerableWordClientActionsForFacet(
    args.facetId,
    allowedClientActions,
  );
  if (!args.facetId || offerable.length === 0) return undefined;
  const chained = chainedCards(args.content, offerable);
  const plan = offerable.includes(WORD_SUBMIT_PLAN_ACTION)
    ? acceptedWordPlanFromHistory(args.content)
    : undefined;
  // A comment card exists only for a submission the host accepted; its draft_id names the card.
  const comments = plan
    ? undefined
    : acceptedWordCommentSubmission(args.content);
  const commentCard =
    comments && offerable.includes(comments.action) ? comments : undefined;
  // A change in parts shows its rows from the accepted section plan until the finish's plan card;
  // an accepted submission of another kind has the Apply and wins over an unfinished one.
  const parts =
    !plan && !commentCard && offerable.includes(WORD_SUBMIT_PLAN_ACTION);
  const sectionPlan = parts
    ? wordPartsSectionPlanCall(args.content)
    : undefined;
  // From the section plan's first streamed arguments the card says that Erato plans the change.
  const planning =
    parts && !sectionPlan
      ? wordPartsPlanningCall(args.content, !!args.generating)
      : undefined;
  const submitted = plan
    ? { ...plan, language: WORD_PLAN_FENCE }
    : sectionPlan
      ? {
          toolCallId: sectionPlan,
          content: sectionPlan,
          language: WORD_PARTS_FENCE,
        }
      : planning
        ? {
            toolCallId: planning,
            content: planning,
            language: WORD_PARTS_FENCE,
            pending: true,
          }
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
    ...(chained
      ? { submittedCards: chained }
      : submitted
        ? {
            submittedCard: {
              toolCallId: submitted.toolCallId,
              content: submitted.content,
              language: submitted.language,
              ...("pending" in submitted ? { pending: true } : {}),
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
    ...(args.clientActionInfo?.grantScope &&
    Object.keys(args.clientActionInfo.grantScope).length > 0
      ? { clientActionGrantScopes: args.clientActionInfo.grantScope }
      : {}),
    // The server carries out a chained proposal after the user's decision in the chat: the
    // pane does not prompt for it as well.
    ...(args.clientActionInfo?.presentation && !isProposalChained(args.content)
      ? { clientActionPresentation: args.clientActionInfo.presentation }
      : {}),
    ...(args.capture
      ? { isFreshCompletion: true, itemIdentity: args.capture.identity }
      : {}),
  };
}
