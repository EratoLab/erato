import { registerClientToolExecutor } from "@erato/frontend/library";

import { wordApprovalScopeOptions } from "./wordApprovalScope";
import {
  wordCommentReadSession,
  WORD_READ_COMMENTS_TOOL,
} from "./wordCommentReadTool";
import {
  createWordCommentSubmissionExecutor,
  WORD_SUBMIT_COMMENT_CHANGES_TOOL,
} from "./wordCommentSubmission";
import {
  wordDocumentReadSession,
  WORD_READ_TOOL,
} from "./wordDocumentReadTool";
import {
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "./wordDocumentSubmission";

import type {
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";

const inclusionOff = (): Promise<ClientToolExecutionResult> =>
  Promise.resolve({ ok: false, error: "Document inclusion is off." });

/**
 * The Word pane's client tools. Only the document read takes delegated tasks' calls (contract §7);
 * the writes and the comment read stay with the coordinator. A task's call skips the inclusion
 * check: switching inclusion off clears the capture, so such a call ends as capture-unavailable.
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
  const read: ClientToolExecutor = (input, context) =>
    readEnabled() || context?.hostGrant
      ? wordDocumentReadSession.execute(input, context)
      : inclusionOff();
  const unregister = [
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
    registerClientToolExecutor(WORD_READ_TOOL, read, undefined, {
      acceptsGrantCalls: true,
      ...wordApprovalScopeOptions(bindingIdentity),
    }),
  ];
  return () => unregister.forEach((stop) => stop());
}
