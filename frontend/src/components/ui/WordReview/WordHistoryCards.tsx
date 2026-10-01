import { plural, t } from "@lingui/core/macro";
import { useId, useMemo, useRef, useState } from "react";

import { CountBadge } from "@/components/ui/Controls/CountBadge";
import { DisclosureChevron } from "@/components/ui/Controls/DisclosureChevron";
import { Row } from "@/components/ui/Controls/Row";
import { useConversationMessages } from "@/components/ui/Message/ConversationMessages";
import { SyntaxHighlightedCode } from "@/components/ui/Message/SyntaxHighlightedCode";
import { TextComparison } from "@/components/ui/Message/TextComparison";
import { editExcerpt, parseWordEdits } from "@/lib/wordReview/wordEditPlan";
import {
  acceptedWordPlanFromHistory,
  wordEditSourceFromHistory,
  wordMessageLineage,
  wordSnapshotFromHistory,
} from "@/lib/wordReview/wordHistory";
import { WORD_EDITS_FENCE } from "@/lib/wordReview/wordHistoryNames";

import {
  WordProposalCard,
  WordProposalReadOnlyFooter,
} from "./WordProposalCard";
import { WordReviewCard, WordReviewHeader } from "./WordReviewCardParts";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { WordEdit } from "@/lib/wordReview/wordEditPlan";
import type { WordHistoryEditSource } from "@/lib/wordReview/wordHistory";
import type { Message } from "@/types/chat";

type HistoryMessage = Pick<Message, "content">;

/** Keeps the previous lineage while its messages are unchanged, so the snapshot is not rebuilt per render. */
function useStableLineage(lineage: HistoryMessage[]): HistoryMessage[] {
  const previous = useRef(lineage);
  const same =
    previous.current.length === lineage.length &&
    previous.current.every((m, i) => m.content === lineage[i].content);
  if (!same) previous.current = lineage;
  return previous.current;
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
  const messages = useConversationMessages();
  const accepted = useMemo(
    () => acceptedWordPlanFromHistory(content),
    [content],
  );
  const found = wordMessageLineage(messages, messageId);
  const lineage = useStableLineage(
    found.length > 0 && found[found.length - 1].content === content
      ? found
      : [...found.slice(0, -1), { content }],
  );
  const snapshot = useMemo(
    () =>
      accepted
        ? wordSnapshotFromHistory(lineage, accepted.plan.snapshot)
        : undefined,
    [accepted, lineage],
  );
  if (!accepted && isStreaming) return null;
  if (!accepted)
    return (
      <p
        className="my-2 text-sm text-theme-fg-muted"
        data-testid="word-history-no-changes"
      >
        {t({
          id: "wordReview.history.noChanges",
          message: "No changes were proposed.",
        })}
      </p>
    );
  return (
    <WordProposalCard
      plan={accepted.plan}
      snapshot={snapshot}
      documentName={documentName}
      testId="word-history-plan"
    />
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

function originalText(
  edit: WordEdit,
  source: WordHistoryEditSource,
): string | null {
  const lines: string[] = [];
  for (let n = edit.paragraph; n <= (edit.through ?? edit.paragraph); n++) {
    const paragraph = source.paragraphs.get(n);
    if (!paragraph || n === source.partialOrdinal) return null;
    lines.push(paragraph.text);
  }
  return lines.join("\n");
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
  const paragraphs = new Set(
    edits.flatMap((edit) =>
      Array.from(
        { length: (edit.through ?? edit.paragraph) - edit.paragraph + 1 },
        (_, i) => edit.paragraph + i,
      ),
    ),
  ).size;
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
          const original = originalText(edit, source);
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
  const source = useMemo(
    () => wordEditSourceFromHistory(previousUserMessage),
    [previousUserMessage],
  );
  const edits = useMemo(
    () => (language === WORD_EDITS_FENCE ? parseWordEdits(content) : null),
    [language, content],
  );
  if (edits) return <WordHistoryEditsCard edits={edits} source={source} />;
  if (language !== WORD_EDITS_FENCE && content.trim())
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
