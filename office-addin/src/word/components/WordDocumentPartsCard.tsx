import {
  useConversationSelector,
  useHostArtifact,
  WordPartsReview,
  WordReviewCard,
} from "@erato/frontend/library";
import { wordPartsProgress } from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";
import { useId } from "react";

import type { WordPartsProgress } from "@erato/frontend/word-review";

const sameProgress = (
  a: WordPartsProgress | undefined,
  b: WordPartsProgress | undefined,
) => a?.key === b?.key;

/**
 * A change in parts while Erato writes it: the section plan's rows, filling as the parts arrive.
 * It has nothing to apply; the finish's plan card takes its place.
 */
export function WordDocumentPartsCard({ callId }: { callId: string }) {
  const artifact = useHostArtifact();
  const messageId = artifact?.messageId;
  const detailsId = useId();
  // Recomputed per streamed update, but the card renders only when a row or the progress changes.
  const progress = useConversationSelector((messages) => {
    const message = messageId === undefined ? undefined : messages[messageId];
    return wordPartsProgress(message?.content, message?.status === "sending");
  }, sameProgress);
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
                  "Erato stopped before finishing, so there is nothing to apply.",
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
