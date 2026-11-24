import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
} from "@erato/frontend/word-review";
import { useMemo } from "react";

import { WordDocumentPlanCard } from "../../word/components/WordDocumentPlanCard";
import { WORD_CLIENT_ACTIONS } from "../../word/utils/wordClientActions";
import {
  runWordPlanApply,
  wordPlanChecksCoauthors,
  wordPlanRouting,
} from "../../word/utils/wordPlanApply";
import { wordWriteBridge } from "../../word/utils/wordWriteBridge";

import type { WordCardDecision } from "../../word/components/WordDecisionChoices";
import type { WordPlanConfirmation } from "../../word/utils/wordApplyCall";

type Decision = Parameters<WordCardDecision["onDecide"]>[0];

const PLAN_ENTRY = WORD_CLIENT_ACTIONS.get("word.apply_document_plan")!;

/**
 * The write the server's apply call makes once the user approved: the pipeline of
 * `createWordApplyPlanExecutor`, on the copy the message's request took.
 */
export async function serverPlanApply(
  messageId: string,
  content: string,
  confirmation?: unknown,
): Promise<void> {
  const host = wordWriteBridge()!;
  const capture = host.captureFor(messageId)!;
  const confirmed = (confirmation ?? {}) as WordPlanConfirmation;
  const parsed = parseWordDocumentPlan(content);
  const plan =
    parsed && capture.authoring
      ? normalizeWordDocumentPlan(parsed, capture.authoring)
      : undefined;
  const routing =
    plan && capture.authoring
      ? wordPlanRouting(plan, capture.authoring, content)
      : undefined;
  await runWordPlanApply({
    key: `${messageId}:${PLAN_ENTRY.action}:${content}`,
    content,
    capture,
    messageId,
    entry: PLAN_ENTRY,
    host,
    importConfirmed: confirmed.importConfirmed === true,
    commentRemovalsConfirmed: confirmed.commentRemovalsConfirmed,
    coauthors: wordPlanChecksCoauthors(routing)
      ? { shown: confirmed.coauthors }
      : undefined,
  });
}

/** A plan card in the chat's decision place; approving it makes the server's write. */
export function DecidedPlanCard({
  messageId,
  content,
  allowAlways = true,
  onDecided,
}: {
  messageId: string;
  content: string;
  /** The server lets the user choose Always for this change. */
  allowAlways?: boolean;
  onDecided?: (decision: Decision) => void;
}) {
  const decision = useMemo<WordCardDecision>(
    () => ({
      allowAlways,
      decideOnScreen: false,
      status: "pending",
      resolvedLabel: undefined,
      isBusy: false,
      onDecide: (choice, extras) => {
        onDecided?.(choice);
        if (choice === "approve" || choice === "approve_always")
          void serverPlanApply(messageId, content, extras?.clientConfirmation);
      },
    }),
    [allowAlways, onDecided, messageId, content],
  );
  return (
    <WordDocumentPlanCard
      entry={PLAN_ENTRY}
      content={content}
      decision={decision}
    />
  );
}
