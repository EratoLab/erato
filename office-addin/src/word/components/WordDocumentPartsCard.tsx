import {
  useChatSession,
  useConversationSelector,
  useHostArtifact,
  WordPartsReview,
  WordReviewCard,
} from "@erato/frontend/library";
import {
  buildWordPlanReview,
  normalizeWordDocumentPlan,
  wordPartsProgress,
} from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";
import { useId, useMemo } from "react";

import { wordPartsChangesByRow } from "../hooks/useWordPlanParts";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  wordPartsApplied,
  wordPartsFromContent,
} from "../utils/wordDocumentParts";

import type { WordPartsProgress } from "@erato/frontend/word-review";

const sameProgress = (
  a: WordPartsProgress | undefined,
  b: WordPartsProgress | undefined,
) => a?.key === b?.key;

/**
 * A change in parts while Erato writes it: the section plan's rows, filling as the parts arrive,
 * each ready row open to its changes. It has nothing to apply; the finish's plan card takes its
 * place.
 */
export function WordDocumentPartsCard({ callId }: { callId: string }) {
  const artifact = useHostArtifact();
  const messageId = artifact?.messageId;
  const detailsId = useId();
  const host = useWordWrite();
  const { getTranscript } = useChatSession();
  const snapshot =
    messageId === undefined
      ? undefined
      : host.capturesByAssistantMessageId.get(messageId)?.authoring;
  // Recomputed per streamed update, but the card renders only when a row or the progress changes.
  const progress = useConversationSelector((messages) => {
    const message = messageId === undefined ? undefined : messages[messageId];
    return wordPartsProgress(message?.content, message?.status === "sending");
  }, sameProgress);
  // Rebuilt when a row changes, never per streamed token, from the calls the chat stored.
  const changes = useMemo(() => {
    if (!progress || progress.stopped || !snapshot || messageId === undefined)
      return undefined;
    const found = wordPartsFromContent(
      getTranscript().messages[messageId]?.content,
      snapshot,
    );
    if (!found?.draft.parts.size) return undefined;
    const applied = wordPartsApplied(found.draft, snapshot, {
      rows: new Set(),
      structure: false,
    });
    return wordPartsChangesByRow(
      buildWordPlanReview(
        normalizeWordDocumentPlan(applied.plan, snapshot),
        snapshot,
      ),
      applied.sectionRowOf,
    );
  }, [progress, snapshot, messageId, getTranscript]);
  if (progress?.callId !== callId) return null;
  return (
    <WordReviewCard
      label={t({
        id: "officeAddin.word.parts.label",
        message: "Document changes in parts",
      })}
      testId="word-document-parts-card"
      collapsed={false}
      detailsId={detailsId}
      footer={
        <p className="word-review__hint">
          {progress.stopped
            ? t({
                id: "officeAddin.word.parts.stopped",
                message:
                  "Erato stopped before finishing, so there is nothing to apply. Send your request again to continue.",
              })
            : t({
                id: "officeAddin.word.parts.applyLater",
                message: "You can apply the change once Erato has finished.",
              })}
        </p>
      }
    >
      <WordPartsReview
        progress={progress}
        changes={changes}
        snapshot={snapshot}
        title={
          progress.stopped
            ? t({
                id: "officeAddin.word.parts.titleStopped",
                message: "Changes not finished",
              })
            : t({
                id: "officeAddin.word.parts.titleWriting",
                message: "Writing the changes",
              })
        }
      />
    </WordReviewCard>
  );
}
