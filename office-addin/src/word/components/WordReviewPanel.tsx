import {
  Alert,
  Button,
  Card,
  CountBadge,
  DisclosureChevron,
  OpenNewWindowIcon,
  Row,
  SettledInfoPill,
  Select,
  TextComparison,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useMemo, useState } from "react";

import {
  isRevertedOutcome,
  statusLabel,
  wordEditsAppliedText,
  wordEditsTitleText,
  wordEditTargetLabel,
  wordEditTotalsText,
  wordRevertedLabel,
} from "./WordEditReport";
import { WordReviewHeader, wordShowInWordLabel } from "./WordReviewCardParts";
import { wordSizeChip } from "./wordPlanLabels";
import {
  editExcerpt,
  planWordEdits,
  wordEditCounts,
} from "../utils/wordEditPlan";
import { wordEditBatchSize } from "../utils/wordPlanReview";

import type { WordDocumentCapture } from "../utils/wordDocumentCapture";
import type { WordEdit, WordEditStatus } from "../utils/wordEditPlan";
import type {
  WordLocationResult,
  WordTrackingMode,
} from "../utils/wordReviewLocation";
import type { WordReviewState } from "../utils/wordReviewState";

export function trackingDescription(mode: WordTrackingMode): string {
  if (mode === "off")
    return t({
      id: "officeAddin.word.review.trackingOff",
      message: "Edits are applied directly. Erato does not add revision marks.",
    });
  if (mode === "on")
    return t({
      id: "officeAddin.word.review.trackingOn",
      message:
        "Word Track Changes is already on. Word may record these edits; Erato will not change that setting.",
    });
  return t({
    id: "officeAddin.word.review.trackingUnknown",
    message:
      "Word tracking status is unavailable. Erato will not change the setting.",
  });
}

function originalText(
  edit: WordEdit,
  capture: WordDocumentCapture | undefined,
): string | null {
  if (
    !capture ||
    (edit.through ?? edit.paragraph) - edit.paragraph >= capture.ordinalMap.size
  )
    return null;
  const paragraphs: string[] = [];
  for (
    let ordinal = edit.paragraph;
    ordinal <= (edit.through ?? edit.paragraph);
    ordinal++
  ) {
    const p = capture.ordinalMap.get(ordinal);
    if (!p) return null;
    paragraphs.push(p.text);
  }
  return paragraphs.join("\n");
}

function compactStatus(
  status: WordEditStatus | undefined,
  reverted: boolean,
): string {
  if (isRevertedOutcome(status, reverted)) return wordRevertedLabel();
  if (status === "applied") return statusLabel(status);
  if (status === "failed")
    return t({ id: "officeAddin.word.review.failed", message: "Failed" });
  if (status)
    return t({ id: "officeAddin.word.review.skipped", message: "Skipped" });
  return t({ id: "officeAddin.word.review.proposed", message: "Proposed" });
}

const STATUS_TONE: Partial<Record<WordEditStatus | "reverted", string>> = {
  applied: "bg-theme-success-bg text-theme-success-fg",
  failed: "bg-theme-error-bg text-theme-error-fg",
  reverted: "bg-theme-bg-secondary text-theme-fg-secondary",
};

function statusTone(
  status: WordEditStatus | undefined,
  reverted: boolean,
): string {
  if (isRevertedOutcome(status, reverted)) return STATUS_TONE.reverted!;
  return (
    (status && STATUS_TONE[status]) ??
    "bg-theme-bg-secondary text-theme-fg-secondary"
  );
}

/** Paragraphs an edit batch touches, counting each ordinal once. */
export function editedParagraphCount(edits: readonly WordEdit[]): number {
  const ordinals = new Set<number>();
  for (const edit of edits)
    for (let p = edit.paragraph; p <= (edit.through ?? edit.paragraph); p++)
      ordinals.add(p);
  return ordinals.size;
}

export function WordReviewPanel({
  edits,
  capture,
  review,
  tracking,
  busy,
  blockedReason,
  locationReason,
  onLocate,
}: {
  edits: readonly WordEdit[];
  capture: WordDocumentCapture | undefined;
  review: WordReviewState;
  tracking: WordTrackingMode;
  busy: boolean;
  blockedReason?: string;
  locationReason: (index: number) => string | undefined;
  onLocate: (index: number) => Promise<WordLocationResult>;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<number | null>(0);
  const [range, setRange] = useState("all");
  const [filter, setFilter] = useState("all");
  const [locationMessages, setLocationMessages] = useState<
    Record<number, string>
  >({});
  const [invalidLocations, setInvalidLocations] = useState<Set<number>>(
    () => new Set(),
  );
  const [locating, setLocating] = useState<number | null>(null);
  const plan = useMemo(
    () => (capture ? planWordEdits(edits, capture) : null),
    [edits, capture],
  );
  const outcomes = new Map(
    review.outcomes.map((outcome) => [outcome.index, outcome]),
  );
  const rejections = new Map(
    plan?.rejected.map((outcome) => [outcome.index, outcome]),
  );
  const rangeStarts = [
    ...new Set(
      edits.map((edit) => Math.floor((edit.paragraph - 1) / 25) * 25 + 1),
    ),
  ].sort((a, b) => a - b);
  const counts = wordEditCounts(review.outcomes);
  const { applied, failed, skipped } = counts;
  const total = edits.length;
  const historical = review.outcomes.length > 0;
  const reverted = review.status === "reverted";
  const filtered = edits
    .map((edit, index) => ({ edit, index }))
    .filter(({ edit, index }) => {
      const status = outcomes.get(index)?.status;
      return (
        (range === "all" ||
          (edit.paragraph <= Number(range) + 24 &&
            (edit.through ?? edit.paragraph) >= Number(range))) &&
        (filter === "all" ||
          (filter === "skipped"
            ? !!status && status !== "applied" && status !== "failed"
            : status === filter))
      );
    });
  const complete = capture?.renderedOrdinals.size ?? 0;
  const documentTotal = capture?.ordinalMap.size ?? 0;
  const title = wordEditsTitleText(editedParagraphCount(edits));
  return (
    <div data-testid={historical ? "word-edit-report" : "word-review-panel"}>
      <WordReviewHeader
        chip={wordSizeChip(wordEditBatchSize(total))}
        title={
          reverted
            ? t({
                id: "officeAddin.word.planReceipt.undone",
                message: `Undone: ${title}`,
              })
            : review.status === "write-failed" ||
                review.status === "error" ||
                review.status === "revert-failed"
              ? t({
                  id: "officeAddin.word.review.incomplete",
                  message: "Batch could not be completed",
                })
              : historical && review.status !== "applying"
                ? wordEditsAppliedText(applied)
                : title
        }
        scope={
          capture
            ? t({
                id: "officeAddin.word.review.coverage",
                message: `${complete} of ${documentTotal} paragraphs included in full`,
              })
            : undefined
        }
      >
        {historical && (
          <p className="word-review__hint" role="status">
            {review.status === "write-failed"
              ? t({
                  id: "officeAddin.word.review.uncertainTotals",
                  message: `${skipped} skipped · ${failed} writes unconfirmed`,
                })
              : reverted
                ? t({
                    id: "officeAddin.word.review.revertedTotals",
                    message: `${applied + failed} edits reverted · ${skipped} skipped`,
                  })
                : wordEditTotalsText(counts)}
          </p>
        )}
        {review.automatic && historical && (
          <p className="word-review__hint">
            {t({
              id: "officeAddin.word.review.automatic",
              message: "Automatic action under your Always allow setting.",
            })}
          </p>
        )}
        {capture ? (
          (complete < documentTotal || capture.partialOrdinal !== null) && (
            <Card
              variant="surface"
              tone="muted"
              size="sm"
              nested
              bodyClassName="word-review__coverage"
            >
              <span>
                {t({
                  id: "officeAddin.word.review.coverageWindow",
                  message: `Request window: paragraphs 1–${capture.paragraphsSent}. Only included text was reviewed.`,
                })}
              </span>
              {capture.partialOrdinal !== null && (
                <span>
                  {t({
                    id: "officeAddin.word.review.partial",
                    message: `Paragraph ${capture.partialOrdinal} was only partly included and cannot be replaced.`,
                  })}
                </span>
              )}
            </Card>
          )
        ) : (
          <Alert type="info" role="status" className="[overflow-wrap:anywhere]">
            {t({
              id: "officeAddin.word.review.noOriginal",
              message:
                "Original comparison and document coverage are unavailable after reload. The proposed text is shown below.",
            })}
          </Alert>
        )}
        <p className="word-review__hint">{trackingDescription(tracking)}</p>
        {historical && (
          <p className="word-review__hint">
            {reverted
              ? t({
                  id: "officeAddin.word.review.revertedComparison",
                  message: "Comparison from the reverted batch.",
                })
              : t({
                  id: "officeAddin.word.review.historical",
                  message:
                    "Original when requested / proposed replacement from this batch. Later changes in Word are not reflected here.",
                })}
          </p>
        )}
        {blockedReason && (
          <Alert type="info" role="status" className="[overflow-wrap:anywhere]">
            {blockedReason}
          </Alert>
        )}
      </WordReviewHeader>
      <div className="word-review__filters">
        <Select
          label={t({
            id: "officeAddin.word.review.paragraphFilter",
            message: "Paragraphs",
          })}
          value={range}
          onChange={(event) => {
            setRange(event.target.value);
            setExpanded(null);
          }}
        >
          <option value="all">
            {t({
              id: "officeAddin.word.review.allParagraphs",
              message: "All paragraphs",
            })}
          </option>
          {rangeStarts.map((start) => (
            <option key={start} value={start}>
              {start}–{start + 24}
            </option>
          ))}
        </Select>
        {historical && (
          <Select
            label={t({
              id: "officeAddin.word.review.outcomeFilter",
              message: "Outcome",
            })}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setExpanded(null);
            }}
          >
            <option value="all">
              {t({
                id: "officeAddin.word.review.allOutcomes",
                message: "All outcomes",
              })}
            </option>
            <option value="applied">
              {compactStatus("applied", reverted)}
            </option>
            <option value="skipped">{compactStatus("changed", false)}</option>
            <option value="failed">{compactStatus("failed", false)}</option>
          </Select>
        )}
        <span>
          {t({
            id: "officeAddin.word.review.shown",
            message: `${filtered.length} of ${total} shown`,
          })}
        </span>
      </div>
      <ol className="word-review__list" data-testid="word-edits-list">
        {filtered.map(({ edit, index }) => {
          const open = expanded === index;
          const outcome = outcomes.get(index);
          const rejection = rejections.get(index);
          const status = outcome?.status ?? rejection?.status;
          const original = originalText(edit, capture);
          const reason =
            blockedReason ??
            locationReason(index) ??
            (invalidLocations.has(index)
              ? t({
                  id: "officeAddin.word.review.locationChanged",
                  message:
                    "This passage changed or moved. Its exact location can no longer be verified.",
                })
              : undefined);
          return (
            <li
              key={index}
              data-status={status ?? "proposed"}
              className={
                open
                  ? "word-review__row word-review__row--open"
                  : "word-review__row"
              }
            >
              <Row
                variant="list"
                as="button"
                className="word-review__row-toggle"
                aria-expanded={open}
                aria-controls={`${id}-edit-${index}`}
                onClick={() => setExpanded(open ? null : index)}
                leading={<CountBadge variant="count">{index + 1}</CountBadge>}
                description={
                  <>
                    {edit.text === ""
                      ? (edit.through ?? edit.paragraph) > edit.paragraph
                        ? t({
                            id: "officeAddin.word.review.clearRange",
                            message: "Clear text and merge paragraphs",
                          })
                        : t({
                            id: "officeAddin.word.review.clearText",
                            message: "Clear paragraph text",
                          })
                      : t({
                          id: "officeAddin.word.review.replaceText",
                          message: "Text replacement · when requested",
                        })}
                    <span className="word-review__excerpt">
                      {editExcerpt(original ?? edit.text)}
                    </span>
                  </>
                }
                trailing={
                  <span className="word-plan-row__trailing">
                    <SettledInfoPill
                      label={compactStatus(status, reverted)}
                      toneClassName={statusTone(status, reverted)}
                    />
                    <DisclosureChevron open={open} />
                  </span>
                }
              >
                {wordEditTargetLabel(edit)}
              </Row>
              {open && (
                <div id={`${id}-edit-${index}`} className="word-review__detail">
                  {status && (
                    <Alert
                      type="info"
                      role="status"
                      className="[overflow-wrap:anywhere]"
                    >
                      {isRevertedOutcome(status, reverted)
                        ? t({
                            id: "officeAddin.word.review.bodyRestored",
                            message:
                              "The document body was restored to just before this batch.",
                          })
                        : statusLabel(status)}
                    </Alert>
                  )}
                  <Button
                    type="button"
                    variant="link"
                    className="word-review__locate"
                    icon={
                      reason ? undefined : (
                        <OpenNewWindowIcon className="size-4 shrink-0" />
                      )
                    }
                    disabled={busy || locating !== null || !!reason}
                    onClick={() => {
                      setLocating(index);
                      void onLocate(index)
                        .then((result) => {
                          const message =
                            result === "selected"
                              ? t({
                                  id: "officeAddin.word.review.selected",
                                  message:
                                    "Passage selected in Word. This may change the insertion location for a later action.",
                                })
                              : result === "cleared"
                                ? t({
                                    id: "officeAddin.word.review.clearedLocation",
                                    message:
                                      "Cursor moved to the cleared paragraph.",
                                  })
                                : t({
                                    id: "officeAddin.word.review.locationChanged",
                                    message:
                                      "This passage changed or moved. Its exact location can no longer be verified.",
                                  });
                          setLocationMessages((current) => ({
                            ...current,
                            [index]: message,
                          }));
                          if (result !== "selected" && result !== "cleared")
                            setInvalidLocations((current) =>
                              new Set(current).add(index),
                            );
                        })
                        .finally(() => setLocating(null));
                    }}
                  >
                    {reason
                      ? t({
                          id: "officeAddin.word.review.locationUnavailable",
                          message: "Location unavailable",
                        })
                      : wordShowInWordLabel()}
                  </Button>
                  {!blockedReason && (reason || locationMessages[index]) && (
                    <p className="word-review__hint" role="status">
                      {reason ?? locationMessages[index]}
                    </p>
                  )}
                  <p className="word-review__comparison-label">
                    {t({
                      id: "officeAddin.word.review.comparisonLabel",
                      message: "Original when requested → proposed replacement",
                    })}
                  </p>
                  <TextComparison original={original} proposed={edit.text} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {filtered.length === 0 && (
        <Alert
          type="info"
          role="status"
          className="m-3 [overflow-wrap:anywhere]"
        >
          {t({
            id: "officeAddin.word.review.emptyFilter",
            message:
              "No edits match this filter. The batch scope has not changed.",
          })}
        </Alert>
      )}
    </div>
  );
}
