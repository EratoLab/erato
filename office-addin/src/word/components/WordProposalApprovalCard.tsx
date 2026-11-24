import { useConversationMessage } from "@erato/frontend/library";
import {
  editedParagraphCount,
  parseWordEdits,
} from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { WordDecisionChoices } from "./WordDecisionChoices";
import { wordEditsTitleText } from "./WordEditReport";
import { answerFences } from "../../core/clientActions/proposalApply";
import { WORD_CLIENT_ACTIONS } from "../utils/wordClientActions";
import { wordProposalActionOf } from "../utils/wordProposalApply";

import type { WordCardDecision } from "./WordDecisionChoices";
import type { ApprovalItemCardProps } from "@erato/frontend/library";

/** An on-screen approval: a proposal from a turn with comment text writes only after one. */
const CONFIRMED = { confirmed: true };

/**
 * A proposed Word action the server carries out, in the decision place: the text it writes above
 * the usual decisions. Without the answer's text the generic card stays.
 */
export function WordProposalApprovalCard({
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
  const action = wordProposalActionOf(item.tool_name);
  const entry = action ? WORD_CLIENT_ACTIONS.get(action) : undefined;
  const content = message?.content;
  const text = useMemo(() => {
    if (!entry) return undefined;
    const fences = answerFences(content).filter(
      (fence) => fence.language === entry.fenceLanguage,
    );
    return fences.length === 1 ? fences[0].body : undefined;
  }, [content, entry]);
  if (status !== "pending" || !entry || text === undefined)
    return <>{renderDefault()}</>;
  const decision: WordCardDecision = {
    allowAlways,
    decideOnScreen: item.chained?.decide_on_screen === true,
    status,
    resolvedLabel,
    isBusy,
    onDecide,
  };
  const edits = action === "word.apply_edits" ? parseWordEdits(text) : null;
  return (
    <div className="space-y-2" data-testid="word-proposal-approval">
      <p className="text-sm font-medium text-theme-fg-primary">
        {edits
          ? wordEditsTitleText(editedParagraphCount(edits))
          : entry.displayLabel()}
      </p>
      {!edits && <pre className="word-review__text">{text}</pre>}
      <WordDecisionChoices
        decision={decision}
        title={t({
          id: "officeAddin.word.chained.consent",
          message: "Apply this change?",
        })}
        applyLabel={entry.displayLabel()}
        canApply
        standingLabel={t({
          id: "officeAddin.word.decision.standing.proposal",
          message: "Every time Erato proposes this:",
        })}
        confirmation={CONFIRMED}
      />
    </div>
  );
}
