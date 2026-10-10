import { plural, t } from "@lingui/core/macro";
import { useId, useMemo, useRef, useState } from "react";

import { CountBadge } from "@/components/ui/Controls/CountBadge";
import { DisclosureChevron } from "@/components/ui/Controls/DisclosureChevron";
import { Row } from "@/components/ui/Controls/Row";
import { SyntaxHighlightedCode } from "@/components/ui/Message/SyntaxHighlightedCode";
import { TextComparison } from "@/components/ui/Message/TextComparison";
import { parseWordDocumentPlan } from "@/lib/wordReview/wordDocumentPlan";
import {
  editedParagraphCount,
  editExcerpt,
  parseWordEdits,
} from "@/lib/wordReview/wordEditPlan";
import {
  isRejectedWordSubmission,
  wordEditOriginal,
  wordEditSourceFromHistory,
  wordEditWindow,
  wordHistoryProposal,
  wordHistoryProposalKey,
} from "@/lib/wordReview/wordHistory";
import {
  WORD_EDITS_FENCE,
  WORD_INSERT_FENCE,
  WORD_PLAN_FENCE,
  WORD_REPLACE_FENCE,
} from "@/lib/wordReview/wordHistoryNames";
import {
  parseWordKeptItems,
  wordSelectionReplyOriginal,
  wordSelectionReplyProposal,
  wordSelectionWithoutMarkers,
} from "@/lib/wordReview/wordSelectionReply";

import {
  WordProposalCard,
  WordProposalReadOnlyFooter,
} from "./WordProposalCard";
import { WordReviewCard, WordReviewHeader } from "./WordReviewCardParts";
import { useWordMessageLineage } from "./useWordHistoryMessage";
import { wordKeptMarkersLabelled } from "./wordKeptMarkerLabels";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { WordEdit } from "@/lib/wordReview/wordEditPlan";
import type { WordHistoryEditSource } from "@/lib/wordReview/wordHistory";
import type { Message } from "@/types/chat";

/** Recomputes only when `key` changes, however often the inputs are rebuilt. */
function useKeyed<T>(key: string, compute: () => T): T {
  const cache = useRef<{ key: string; value: T } | null>(null);
  if (cache.current?.key !== key) cache.current = { key, value: compute() };
  return cache.current.value;
}

/**
 * The plan a Word chat proposed, reviewed against the document as its reads
 * returned it. Outside Word nothing can be applied, so the card is read-only.
 */
export function WordHistoryPlanCard({
  messageId,
  content,
  documentName,
  isStreaming = false,
}: {
  messageId: string;
  content: ContentPart[];
  documentName?: string;
  /** While the answer streams, a missing acceptance may still arrive. */
  isStreaming?: boolean;
}) {
  const stored = useWordMessageLineage(messageId);
  const lineage =
    stored.length > 0 && stored[stored.length - 1].content === content
      ? stored
      : [...stored.slice(0, -1), { content }];
  const proposal = useKeyed(wordHistoryProposalKey(lineage, content), () =>
    wordHistoryProposal(lineage, content),
  );
  if (proposal)
    return (
      <WordProposalCard
        plan={proposal.plan}
        snapshot={proposal.snapshot}
        documentName={documentName ?? proposal.documentName}
        testId="word-history-plan"
      />
    );
  if (isStreaming || !content.some(isRejectedWordSubmission)) return null;
  return (
    <p
      className="my-2 text-sm text-theme-fg-muted"
      data-testid="word-history-not-accepted"
    >
      {t({
        id: "wordReview.history.notAccepted",
        message:
          "A change was proposed but did not pass validation, so there is nothing to apply.",
      })}
    </p>
  );
}

function paragraphLabel({ paragraph, through }: WordEdit): string {
  return through === undefined || through === paragraph
    ? t({
        id: "wordReview.history.paragraph",
        message: `Paragraph ${paragraph}`,
      })
    : t({
        id: "wordReview.history.paragraphRange",
        message: `Paragraphs ${paragraph}–${through}`,
      });
}

function WordHistoryEditsCard({
  edits,
  source,
}: {
  edits: WordEdit[];
  source: WordHistoryEditSource;
}) {
  const id = useId();
  const detailsId = useId();
  const [open, setOpen] = useState<number | null>(0);
  const paragraphs = editedParagraphCount(edits, wordEditWindow(source));
  const { paragraphsSent, paragraphsTotal, partialOrdinal } = source;
  return (
    <WordReviewCard
      label={t({
        id: "wordReview.history.editsLabel",
        message: "Proposed paragraph edits",
      })}
      testId="word-history-edits"
      collapsed={false}
      detailsId={detailsId}
      footer={
        <WordProposalReadOnlyFooter
          text={() => edits.map((edit) => edit.text).join("\n\n")}
          documentName={source.documentName}
        />
      }
    >
      <WordReviewHeader
        title={t({
          id: "wordReview.history.editsTitle",
          message: plural(paragraphs, {
            one: "Change # paragraph",
            other: "Change # paragraphs",
          }),
        })}
      >
        {paragraphsSent !== undefined &&
          paragraphsTotal !== undefined &&
          paragraphsSent < paragraphsTotal && (
            <p className="word-review__hint">
              {t({
                id: "wordReview.history.coverage",
                message: `Request window: paragraphs 1–${paragraphsSent} of ${paragraphsTotal}. Only included text was reviewed.`,
              })}
            </p>
          )}
        {partialOrdinal !== null && (
          <p className="word-review__hint">
            {t({
              id: "wordReview.history.partial",
              message: `Paragraph ${partialOrdinal} was only partly included in the request.`,
            })}
          </p>
        )}
      </WordReviewHeader>
      <ol className="word-review__list" data-testid="word-history-edits-list">
        {edits.map((edit, index) => {
          const expanded = open === index;
          const original = wordEditOriginal(edit, source);
          // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
          const rowId = `${id}-edit-${index}`;
          return (
            <li
              key={index}
              className={
                expanded
                  ? "word-review__row word-review__row--open"
                  : "word-review__row"
              }
            >
              <Row
                variant="list"
                as="button"
                className="word-review__row-toggle"
                aria-expanded={expanded}
                aria-controls={rowId}
                onClick={() => setOpen(expanded ? null : index)}
                leading={<CountBadge variant="count">{index + 1}</CountBadge>}
                description={
                  <span className="word-review__excerpt">
                    {editExcerpt(original ?? edit.text)}
                  </span>
                }
                trailing={<DisclosureChevron open={expanded} />}
              >
                {paragraphLabel(edit)}
              </Row>
              {expanded && (
                <div id={rowId} className="word-review__detail">
                  <TextComparison original={original} proposed={edit.text} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </WordReviewCard>
  );
}

function WordHistoryInsertCard({
  text,
  documentName,
}: {
  text: string;
  documentName?: string;
}) {
  const detailsId = useId();
  return (
    <WordReviewCard
      label={t({
        id: "wordReview.history.insertLabel",
        message: "Proposed text to insert",
      })}
      testId="word-history-insert"
      collapsed={false}
      detailsId={detailsId}
      footer={
        <WordProposalReadOnlyFooter
          text={() => text}
          documentName={documentName}
        />
      }
    >
      <WordReviewHeader
        title={t({
          id: "wordReview.history.insertTitle",
          message: "Insert text at the cursor",
        })}
      />
      <div className="word-review__detail">
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
          {text}
        </p>
      </div>
    </WordReviewCard>
  );
}

function WordHistoryReplaceCard({
  content,
  args,
  documentName,
}: {
  content: string;
  args: Record<string, string> | undefined;
  documentName?: string;
}) {
  const detailsId = useId();
  const notes = useMemo(
    () => parseWordKeptItems(args?.kept_items),
    [args?.kept_items],
  );
  const proposal = wordSelectionReplyProposal(content, args?.selection_shape);
  const original = wordSelectionReplyOriginal(args);
  return (
    <WordReviewCard
      label={t({
        id: "wordReview.history.replaceLabel",
        message: "Proposed rewrite of a selected passage",
      })}
      testId="word-history-replace"
      collapsed={false}
      detailsId={detailsId}
      footer={
        <WordProposalReadOnlyFooter
          text={() => wordSelectionWithoutMarkers(proposal, notes)}
          documentName={documentName}
        />
      }
    >
      <WordReviewHeader
        title={t({
          id: "wordReview.history.replaceTitle",
          message: "Rewrite of the selected passage",
        })}
      >
        {original !== null ? (
          <p className="word-review__comparison-label">
            {t({
              id: "wordReview.history.replaceComparison",
              message: "Selection when requested → proposed replacement",
            })}
          </p>
        ) : (
          <p className="word-review__hint">
            {args?.selection_role === "context_only"
              ? t({
                  id: "wordReview.history.replaceContextOnly",
                  message:
                    "Word could not replace this selection, so only the proposal is shown.",
                })
              : t({
                  id: "wordReview.history.replaceNotStored",
                  message:
                    "The selection was not stored in full, so only the proposal is shown.",
                })}
          </p>
        )}
        <TextComparison
          original={original && wordKeptMarkersLabelled(original, notes)}
          proposed={wordKeptMarkersLabelled(proposal, notes)}
        />
      </WordReviewHeader>
    </WordReviewCard>
  );
}

/** A Word card fence of a stored answer, rendered read-only; an incomplete payload stays code. */
export function WordHistoryFenceCard({
  language,
  content,
  previousUserMessage,
}: {
  language: string;
  content: string;
  previousUserMessage: Pick<Message, "action_facet_args"> | undefined;
}) {
  const plan = useMemo(
    () =>
      language === WORD_PLAN_FENCE ? parseWordDocumentPlan(content) : null,
    [language, content],
  );
  const source = useMemo(
    () => wordEditSourceFromHistory(previousUserMessage),
    [previousUserMessage],
  );
  const edits = useMemo(
    () => (language === WORD_EDITS_FENCE ? parseWordEdits(content) : null),
    [language, content],
  );
  if (edits) return <WordHistoryEditsCard edits={edits} source={source} />;
  if (plan)
    return (
      <WordProposalCard
        plan={plan}
        documentName={source.documentName}
        testId="word-history-plan"
      />
    );
  if (language === WORD_REPLACE_FENCE && content.trim())
    return (
      <WordHistoryReplaceCard
        content={content}
        args={previousUserMessage?.action_facet_args}
        documentName={source.documentName}
      />
    );
  if (language === WORD_INSERT_FENCE && content.trim())
    return (
      <WordHistoryInsertCard
        text={content}
        documentName={source.documentName}
      />
    );
  return (
    <SyntaxHighlightedCode
      code={content}
      language={language}
      surface="hoisted"
    />
  );
}
