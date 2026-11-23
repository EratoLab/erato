import {
  HostArtifactProvider,
  useConversationMessage,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { WordCommentChangesCard } from "./WordCommentChangesCard";
import { WordDocumentPlanCard } from "./WordDocumentPlanCard";
import { useWordLiveCapture } from "../hooks/useWordChainedApply";
import { wordAcceptedPlan } from "../utils/wordAcceptedSubmissions";
import {
  WORD_APPLY_COMMENTS_TOOL,
  WORD_APPLY_PLAN_TOOL,
} from "../utils/wordApplyCall";
import { WORD_CLIENT_ACTIONS } from "../utils/wordClientActions";
import { wordCommentDraft } from "../utils/wordCommentSubmission";

import type { WordCardDecision } from "./WordDecisionChoices";
import type { ApprovalItemCardProps } from "@erato/frontend/library";

/** The pane's Word namespace, as the server names the apply tools' requests. */
const WORD_NAMESPACE = "word";

export function wordReadAgainText(): string {
  return t({
    id: "officeAddin.word.chained.readAgain",
    message:
      "The document has to be read again before this change can be made.",
  });
}

/**
 * A Word change the server applies, drawn in the decision place with the pane's own review: the
 * rows, the comparison, the warnings and the ticks. Anything else gets the generic card.
 */
export function WordApprovalItemCard(props: ApprovalItemCardProps) {
  const { item, serverId } = props;
  if (
    serverId !== WORD_NAMESPACE ||
    !item.chained ||
    (item.tool_name !== WORD_APPLY_PLAN_TOOL &&
      item.tool_name !== WORD_APPLY_COMMENTS_TOOL)
  )
    return <>{props.renderDefault()}</>;
  return <WordChainedApprovalCard {...props} />;
}

function WordChainedApprovalCard({
  item,
  messageId,
  allowAlways,
  status,
  resolvedLabel,
  isBusy,
  onDecide,
  renderDefault,
}: ApprovalItemCardProps) {
  const message = useConversationMessage(messageId);
  const submissionCallId = item.chained?.submission_call_id ?? "";
  const plan =
    item.tool_name === WORD_APPLY_PLAN_TOOL
      ? wordAcceptedPlan(submissionCallId)
      : undefined;
  const live = useWordLiveCapture(plan?.snapshotToken);
  const artifact = message?.hostArtifact;
  if (status !== "pending" || !artifact) return <>{renderDefault()}</>;
  const decision: WordCardDecision = {
    allowAlways,
    decideOnScreen: item.chained?.decide_on_screen === true,
    status,
    resolvedLabel,
    isBusy,
    onDecide,
  };
  // After a reload the pane no longer holds the copy the change was checked on.
  const readAgain = () => <>{renderDefault({ note: wordReadAgainText() })}</>;
  if (item.tool_name === WORD_APPLY_PLAN_TOOL) {
    if (!plan || plan.messageId !== messageId || !live) return readAgain();
    return (
      <HostArtifactProvider value={artifact}>
        <WordDocumentPlanCard
          entry={WORD_CLIENT_ACTIONS.get("word.apply_document_plan")!}
          content={plan.content}
          decision={decision}
        />
      </HostArtifactProvider>
    );
  }
  const draft = wordCommentDraft(submissionCallId);
  if (!draft) return readAgain();
  return (
    <HostArtifactProvider value={artifact}>
      <WordCommentChangesCard
        entry={WORD_CLIENT_ACTIONS.get(draft.action)!}
        content={submissionCallId}
        decision={decision}
      />
    </HostArtifactProvider>
  );
}
