import {
  parseWordCommentContext,
  WORD_ANCHORED_COMMENTS_ARG,
  WORD_COMMENT_MAP_ARG,
  WORD_COMMENT_THREAD_FACET_ID,
} from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";

import {
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "./wordActionFacet";
import {
  wordCommentSpokenText,
  wordOpenCommentsLabelText,
} from "./wordCommentChips";
import {
  wordCommentByText,
  wordCommentUnknownText,
  wordCommentWhyText,
} from "./wordCommentText";
import {
  wordDocumentCommentsText,
  wordDocumentCoverageText,
  wordDocumentLeadFact,
  wordSelectionMetaText,
  wordSelectionTooLongText,
} from "./wordContextChips";
import {
  quotedSelection,
  selectionExcerpt,
} from "../../core/selection/selectionExcerpt";

import type { WordDocumentCoverage } from "./buildWordDocumentArgs";
import type { SentWithChip, SentWithDescriptor } from "@erato/frontend/library";

type Args = Readonly<Record<string, string>>;

const count = (value: string | undefined): number | null =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : null;

const joinMeta = (...parts: (string | undefined)[]) => {
  const meta = parts.filter(Boolean).join(" · ");
  return meta ? { meta } : {};
};

const documentChip = (args: Args, meta: { meta?: string }): SentWithChip => ({
  id: "word.document",
  kind: "word.document",
  icon: "document",
  label:
    args.document_name ||
    t({
      id: "officeAddin.word.context.document.unnamed",
      message: "This document",
    }),
  spokenLabel: t({
    id: "officeAddin.word.context.document.spoken",
    message: "Document",
  }),
  ...meta,
});

/** The map's first page, as many rows as the composer's document chip counted. */
const mapCount = (args: Args): number => {
  const summary = parseWordCommentContext(args);
  return summary?.carrier === WORD_COMMENT_MAP_ARG && summary.envelope
    ? summary.envelope.index.length
    : 0;
};

/** The document meta as the composer drew it when it was sent, its transient facts aside. */
const documentMeta = (
  args: Args,
  coverage: string | undefined,
  lead: { text: string } | null,
) => {
  const mapped = mapCount(args);
  return joinMeta(
    lead?.text,
    coverage,
    lead || mapped === 0 ? undefined : wordDocumentCommentsText(mapped),
  );
};

const reviewChips: SentWithDescriptor = (args) => {
  const total = count(args.paragraphs_total);
  const sent = count(args.paragraphs_sent) ?? total;
  const coverage: WordDocumentCoverage | null =
    total === null || sent === null
      ? null
      : {
          paragraphsTotal: total,
          paragraphsSent: sent,
          truncated: sent < total,
          partialParagraph: !!args.truncation_note,
          hasContent: true,
        };
  const lead = wordDocumentLeadFact({
    trackChanges: args.review_status?.startsWith("read-only") ?? false,
    lastingIssue: null,
    readInParts: false,
    bodyOnly: false,
  });
  return [
    documentChip(
      args,
      documentMeta(
        args,
        coverage
          ? wordDocumentCoverageText({
              status: "included",
              coverage,
              authoringRoute: false,
            })
          : undefined,
        lead,
      ),
    ),
  ];
};

const authoringChips: SentWithDescriptor = (args) => {
  const total = count(args.paragraphs_total);
  const lead = wordDocumentLeadFact({
    trackChanges: false,
    lastingIssue: null,
    readInParts:
      args.authoring_status?.startsWith("available for scoped reads") ?? false,
    bodyOnly: false,
  });
  return [
    documentChip(
      args,
      documentMeta(
        args,
        total === null
          ? undefined
          : wordDocumentCoverageText({
              status: "included",
              coverage: {
                paragraphsTotal: total,
                paragraphsSent: 0,
                truncated: false,
                partialParagraph: false,
                hasContent: true,
              },
              authoringRoute: true,
            }),
        lead,
      ),
    ),
  ];
};

const composeChips: SentWithDescriptor = (args) => [
  documentChip(
    args,
    joinMeta(
      wordDocumentCoverageText({
        status: "empty",
        coverage: null,
        authoringRoute: false,
      }),
    ),
  ),
];

/** The passage's threads the request carried, full or listed. */
const anchoredCount = (args: Args): number => {
  const summary = parseWordCommentContext(args);
  if (summary?.carrier !== WORD_ANCHORED_COMMENTS_ARG || !summary.envelope)
    return 0;
  const { coverage } = summary.envelope;
  return coverage.sent_full + coverage.sent_index_only;
};

const selectionChips: SentWithDescriptor = (args) => {
  const spokenLabel = t({
    id: "officeAddin.word.context.selection.spoken",
    message: "Selection",
  });
  const text = args.selected_text ?? "";
  const paragraphs = count(args.paragraph_count);
  const comments = anchoredCount(args);
  return [
    {
      id: "word.selection",
      kind: "word.selection",
      icon: "selection",
      label: text ? quotedSelection(selectionExcerpt(text)) : spokenLabel,
      spokenLabel,
      ...(text ? { quote: text, labelIsExcerpt: true } : {}),
      ...joinMeta(
        args.truncated === "true"
          ? wordSelectionTooLongText()
          : paragraphs === null
            ? undefined
            : wordSelectionMetaText(
                paragraphs,
                comments > 0
                  ? { count: comments, checked: true, readFailed: false }
                  : null,
              ),
      ),
    },
  ];
};

const commentThreadChips: SentWithDescriptor = (args) => {
  const summary = parseWordCommentContext(args);
  if (summary?.carrier !== WORD_COMMENT_THREAD_FACET_ID) return null;
  const { picked, envelope } = summary;
  if (picked) {
    const first = picked.entries.at(0);
    const why = envelope?.why;
    return [
      {
        id: "word.comment",
        kind: "word.comment",
        icon: "comment",
        label: first ? wordCommentByText(first.by) : wordCommentUnknownText(),
        spokenLabel: wordCommentSpokenText(why === "chosen"),
        ...(first?.text ? { quote: first.text } : {}),
        ...joinMeta(why ? wordCommentWhyText(why) : undefined),
      },
    ];
  }
  if (!envelope) return null;
  return [
    {
      id: "word.openComments",
      kind: "word.openComments",
      icon: "comments",
      label: wordOpenCommentsLabelText(envelope.coverage.open),
      spokenLabel: t({
        id: "officeAddin.word.context.openComments.spoken",
        message: "Open comments",
      }),
    },
  ];
};

/**
 * How a sent Word request names what it carried, by facet: the document, the passage, or the
 * comment thread, through the formatters the composer chips use, so the two never read apart.
 */
export const wordSentWithDescriptors: Readonly<
  Record<string, SentWithDescriptor>
> = {
  [WORD_DOCUMENT_REVIEW_FACET_ID]: reviewChips,
  [WORD_AUTHORING_FACET_ID]: authoringChips,
  [WORD_COMPOSE_FACET_ID]: composeChips,
  [WORD_SELECTION_FACET_ID]: selectionChips,
  [WORD_COMMENT_THREAD_FACET_ID]: commentThreadChips,
};
