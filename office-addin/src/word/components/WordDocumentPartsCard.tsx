import {
  useChatSession,
  useConversationSelector,
  useHostArtifact,
  WordPartsReview,
  wordPartsPlanningText,
  WordReviewCard,
  WordReviewGenerating,
  WordReviewHeader,
} from "@erato/frontend/library";
import {
  buildWordPlanReview,
  normalizeWordDocumentPlan,
  wordPartsPlanningCall,
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

type PartsState =
  | { kind: "planning"; callId: string }
  | { kind: "parts"; progress: WordPartsProgress }
  | undefined;

const stateKey = (state: PartsState) =>
  state?.kind === "parts"
    ? `parts:${state.progress.key}`
    : state
      ? `planning:${state.callId}`
      : "";
const sameState = (a: PartsState, b: PartsState) => stateKey(a) === stateKey(b);

/**
 * A change in parts while Erato writes it: one line while Erato plans it, then the section plan's
 * rows, filling as the parts arrive, each ready row open to its changes. It has nothing to apply;
 * the finish's plan card takes its place.
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
  const state = useConversationSelector((messages): PartsState => {
    const message = messageId === undefined ? undefined : messages[messageId];
    const generating = message?.status === "sending";
    const progress = wordPartsProgress(message?.content, generating);
    if (progress) return { kind: "parts", progress };
    const planning = wordPartsPlanningCall(message?.content, generating);
    return planning ? { kind: "planning", callId: planning } : undefined;
  }, sameState);
  const progress = state?.kind === "parts" ? state.progress : undefined;
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
  if (state?.kind === "planning")
    return state.callId === callId ? (
      <WordReviewGenerating label={wordPartsPlanningText()} />
    ) : null;
  if (progress?.callId !== callId) return null;
  const label = t({
    id: "officeAddin.word.parts.label",
    message: "Document changes in parts",
  });
  if (progress.stopped)
    return (
      <WordReviewCard
        label={label}
        testId="word-document-parts-card"
        collapsed={false}
        detailsId={detailsId}
        footer={
          <p className="word-review__hint">
            {t({
              id: "officeAddin.word.parts.stopped",
              message:
                "Erato stopped before finishing, so there is nothing to apply. Send your request again to continue.",
            })}
          </p>
        }
      >
        <WordReviewHeader
          title={t({
            id: "officeAddin.word.parts.titleStopped",
            message: "Changes not finished",
          })}
          scope={progress.intent}
        />
      </WordReviewCard>
    );
  return (
    <WordReviewCard
      label={label}
      testId="word-document-parts-card"
      collapsed={false}
      detailsId={detailsId}
      footer={null}
    >
      <WordPartsReview
        progress={progress}
        changes={changes}
        snapshot={snapshot}
        title={t({
          id: "officeAddin.word.parts.titleWriting",
          message: "Writing the changes",
        })}
      />
    </WordReviewCard>
  );
}
