import { registerClientToolExecutor } from "@erato/frontend/library";
import {
  WORD_PLAN_SECTIONS_TOOL,
  WORD_WRITE_SECTION_TOOL,
} from "@erato/frontend/word-review";

import {
  createWordApplyPlanExecutor,
  WORD_APPLY_COMMENTS_TOOL,
  WORD_APPLY_PLAN_TOOL,
} from "./wordApplyCall";
import { createWordApplyCommentsExecutor } from "./wordApplyCommentCall";
import { wordApprovalScopeOptions } from "./wordApprovalScope";
import {
  wordCommentReadSession,
  WORD_READ_COMMENTS_TOOL,
} from "./wordCommentReadTool";
import {
  createWordCommentSubmissionExecutor,
  WORD_SUBMIT_COMMENT_CHANGES_TOOL,
} from "./wordCommentSubmission";
import { createWordDocumentPartExecutors } from "./wordDocumentPartTools";
import {
  captureUnavailable,
  wordDocumentReadSession,
  WORD_READ_TOOL,
} from "./wordDocumentReadTool";
import {
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "./wordDocumentSubmission";
import {
  createWordProposalExecutor,
  WORD_PROPOSAL_TOOLS,
} from "./wordProposalApply";

import type {
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";

const inclusionOff = (): Promise<ClientToolExecutionResult> =>
  Promise.resolve({ ok: false, error: "Document inclusion is off." });

/**
 * The Word pane's client tools. Only the document read takes delegated tasks' calls (contract §7);
 * the writes and the comment read stay with the coordinator. The two apply tools are the server's
 * own calls after an accepted submission; they are offered only while the document is included. The
 * proposal tools are the server's calls for a proposed action the user approved in the chat. With inclusion off a task's call is
 * capture-unavailable at once: the pane clears the capture only after the render commits.
 */
export function registerWordClientTools({
  readEnabled,
  bindingIdentity,
}: {
  readEnabled: () => boolean;
  /** The pane binding's identity: the scope id the server derives for this document. */
  bindingIdentity: () => string | undefined;
}): () => void {
  const submit = createWordDocumentSubmissionExecutor(wordDocumentReadSession);
  const parts = createWordDocumentPartExecutors(wordDocumentReadSession);
  const read: ClientToolExecutor = (input, context) => {
    if (readEnabled()) return wordDocumentReadSession.execute(input, context);
    return context?.hostGrant
      ? Promise.resolve(captureUnavailable())
      : inclusionOff();
  };
  const unregister = [
    wordDocumentReadSession.followCopies((owner, ordinalMap) =>
      wordCommentReadSession.followDocument(owner, ordinalMap),
    ),
    registerClientToolExecutor(
      WORD_READ_COMMENTS_TOOL,
      wordCommentReadSession.execute,
    ),
    registerClientToolExecutor(
      WORD_SUBMIT_COMMENT_CHANGES_TOOL,
      createWordCommentSubmissionExecutor(),
    ),
    registerClientToolExecutor(WORD_SUBMIT_PLAN_TOOL, (input, context) =>
      readEnabled() ? submit(input, context) : inclusionOff(),
    ),
    registerClientToolExecutor(WORD_PLAN_SECTIONS_TOOL, (input, context) =>
      readEnabled() ? parts.plan(input, context) : inclusionOff(),
    ),
    registerClientToolExecutor(WORD_WRITE_SECTION_TOOL, (input, context) =>
      readEnabled() ? parts.write(input, context) : inclusionOff(),
    ),
    registerClientToolExecutor(
      WORD_APPLY_PLAN_TOOL,
      createWordApplyPlanExecutor({ readEnabled }),
      readEnabled,
    ),
    registerClientToolExecutor(
      WORD_APPLY_COMMENTS_TOOL,
      createWordApplyCommentsExecutor({ readEnabled }),
      readEnabled,
    ),
    // The server's calls for proposed actions; each writes on the copy taken at Send.
    ...Object.values(WORD_PROPOSAL_TOOLS).map((tool) =>
      registerClientToolExecutor(tool, createWordProposalExecutor(tool)),
    ),
    registerClientToolExecutor(WORD_READ_TOOL, read, undefined, {
      acceptsGrantCalls: true,
      ...wordApprovalScopeOptions(bindingIdentity),
    }),
  ];
  return () => unregister.forEach((stop) => stop());
}
