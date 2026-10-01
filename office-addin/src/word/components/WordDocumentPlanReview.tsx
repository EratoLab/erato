import {
  Card,
  DisclosureChevron,
  Row,
  SegmentedControl,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useEffect, useId, useRef, useState } from "react";

import { WordNativeBlockPreview } from "./WordNativeBlockPreview";
import {
  PLAN_ROW_PREVIEW_ROWS,
  WordPlanChangeRow,
  WordPlanStatusPill,
} from "./WordPlanChangeRow";
import {
  WordCheckFirst,
  WordDisclosure,
  WordReviewHeader,
} from "./WordReviewCardParts";
import { WordRichBlockSequence } from "./WordRichBlockPreview";
import {
  wordPlanChip,
  wordPlanGroupSummaryText,
  wordPlanScopeText,
  wordPlanTitleText,
} from "./wordPlanLabels";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanOutputItem,
  WordSourceBlock,
} from "../utils/wordDocumentPlan";
import type {
  WordPlanGroup,
  WordPlanReview,
  WordPlanRow,
} from "../utils/wordPlanReview";

type RowsProps = {
  rows: WordPlanRow[];
  snapshot?: WordAuthoringSnapshot;
  onLocate?: (ref: string) => void;
  locatable: ReadonlySet<string>;
  openRows: ReadonlySet<string>;
  setRowOpen: (key: string, open: boolean) => void;
};

function PlanRows({
  rows,
  snapshot,
  onLocate,
  locatable,
  openRows,
  setRowOpen,
}: RowsProps) {
  if (!rows.length) return null;
  return (
    <ul className="word-review__list">
      {rows.map((row) => (
        <WordPlanChangeRow
          key={row.key}
          row={row}
          snapshot={snapshot}
          onLocate={onLocate}
          locatable={!!row.locateRef && locatable.has(row.locateRef)}
          open={openRows.has(row.key)}
          onOpenChange={(open) => setRowOpen(row.key, open)}
        />
      ))}
    </ul>
  );
}

/** Blocks drawn in the output preview; the rest are left for Word. */
export const PLAN_PREVIEW_MAX_BLOCKS = 40;

/** The document as it will read after applying, without source mapping. */
function WordPlanOutputPreview({
  output,
  snapshot,
  checkInWordShown,
}: {
  output: WordPlanOutputItem[];
  snapshot: WordAuthoringSnapshot;
  checkInWordShown: boolean;
}) {
  const hidden = output.length - PLAN_PREVIEW_MAX_BLOCKS;
  const runs: (
    | { key: string; native: WordSourceBlock }
    | { key: string; blocks: WordPlanBlock[] }
  )[] = [];
  for (const item of output.slice(0, PLAN_PREVIEW_MAX_BLOCKS)) {
    if (item.block.type === "native") {
      runs.push({ key: item.key, native: item.block });
      continue;
    }
    const last = runs[runs.length - 1];
    // Retained source paragraphs share the plan block shape the preview reads.
    const block = item.block as WordPlanBlock;
    if (last && "blocks" in last) last.blocks.push(block);
    else runs.push({ key: item.key, blocks: [block] });
  }
  return (
    <div
      className="word-plan-review__preview focus-ring"
      data-jump-target
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the preview.
      tabIndex={0}
      role="region"
      aria-label={t({
        id: "officeAddin.word.planReview.preview",
        message: "Preview of the result",
      })}
    >
      {runs.map((run) =>
        "native" in run ? (
          <WordNativeBlockPreview key={run.key} block={run.native} />
        ) : (
          <WordRichBlockSequence
            key={run.key}
            blocks={run.blocks}
            snapshot={snapshot}
            maxTableRows={PLAN_ROW_PREVIEW_ROWS}
          />
        ),
      )}
      {hidden > 0 && (
        <p className="word-review__hint">
          {checkInWordShown
            ? t({
                id: "officeAddin.word.planReview.moreBlocksShort",
                message: plural(hidden, {
                  one: "# more block not shown here.",
                  other: "# more blocks not shown here.",
                }),
              })
            : t({
                id: "officeAddin.word.planReview.moreBlocks",
                message: plural(hidden, {
                  one: "# more block not shown here. Check it in Word after applying.",
                  other:
                    "# more blocks not shown here. Check them in Word after applying.",
                }),
              })}
        </p>
      )}
    </div>
  );
}

function groupTitle(group: WordPlanGroup): string {
  return (
    group.heading?.text ||
    t({
      id: "officeAddin.word.authoring.opening",
      message: "Opening content",
    })
  );
}

function SectionGroup({
  group,
  expanded,
  onToggle,
  showUnchanged,
  rowsProps,
}: {
  group: WordPlanGroup;
  expanded: boolean;
  onToggle: () => void;
  showUnchanged: boolean;
  rowsProps: Omit<RowsProps, "rows">;
}) {
  const id = useId();
  const rows = showUnchanged
    ? group.rows
    : group.rows.filter((row) => row.family !== "unchanged");
  // The status pill already says the whole section goes.
  const summary = wordPlanGroupSummaryText(
    group.status === "removed"
      ? { ...group.summary, removed: 0 }
      : group.summary,
  );
  return (
    <li className="word-plan-review__group" data-group-key={group.key}>
      <Card
        variant="expandable"
        size="none"
        expanded={expanded}
        unmountOnCollapse
        bodyId={`${id}-body`}
        header={
          <Row
            variant="list"
            as="button"
            className="word-review__row-toggle"
            aria-expanded={expanded}
            aria-controls={`${id}-body`}
            onClick={onToggle}
            leading={<DisclosureChevron open={expanded} />}
            description={summary || undefined}
            trailing={<WordPlanStatusPill status={group.status} />}
          >
            {groupTitle(group)}
          </Row>
        }
      >
        <PlanRows rows={rows} {...rowsProps} />
      </Card>
    </li>
  );
}

type GroupFilter = "changed" | "all";

export function WordDocumentPlanReview({
  plan,
  snapshot,
  review,
  onLocate,
}: {
  plan: WordDocumentPlan;
  /** Absent for a saved plan: rows then come from plan data alone. */
  snapshot?: WordAuthoringSnapshot;
  review: WordPlanReview;
  onLocate?: (ref: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        review.groups
          .filter((g) => g.status !== "unchanged")
          .slice(0, 1)
          .map((g) => g.key),
      ),
  );
  const [filter, setFilter] = useState<GroupFilter>("changed");
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (!focusKey) return;
    const target = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ??
        [],
    ).find((item) => item.dataset.rowKey === focusKey);
    // A restructured plan draws its text as one preview instead of rows.
    const focusable =
      target?.querySelector<HTMLElement>("button, [tabindex]") ??
      containerRef.current?.querySelector<HTMLElement>("[data-jump-target]");
    focusable?.focus();
    focusable?.scrollIntoView?.({ block: "nearest" });
    setFocusKey(null);
  }, [focusKey]);

  const toggle = (
    set: (update: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void,
    key: string,
    open: boolean,
  ) =>
    set((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  const rowsProps = {
    snapshot,
    onLocate,
    locatable: review.locatable,
    openRows,
    setRowOpen: (key: string, open: boolean) => toggle(setOpenRows, key, open),
  };
  const jump = (rowKey: string) => {
    const group = review.groups.find((g) =>
      g.rows.some((row) => row.key === rowKey),
    );
    if (group) {
      toggle(setOpenGroups, group.key, true);
      if (group.status === "unchanged") setFilter("all");
    }
    toggle(setOpenRows, rowKey, true);
    setFocusKey(rowKey);
  };

  const large = review.size === "large" && review.variant !== "restructured";
  const restructured = review.variant === "restructured";
  const bodyRows = restructured
    ? review.rows.filter(
        (row) =>
          row.status === "removed" &&
          (row.family === "object" || row.family === "table"),
      )
    : review.rows;
  const visibleGroups =
    filter === "all"
      ? review.groups
      : review.groups.filter((g) => g.status !== "unchanged");

  return (
    <div ref={containerRef} className="word-plan-review">
      <WordReviewHeader
        chip={wordPlanChip(review)}
        title={wordPlanTitleText(review.title)}
        scope={wordPlanScopeText(review, plan) || undefined}
      >
        {review.riskUnknown && (
          <p className="word-review__hint">
            {t({
              id: "officeAddin.word.planReview.savedDraft",
              message:
                "Saved draft: the original document is not available in this session, so removed headings, tables and objects could not be checked.",
            })}
          </p>
        )}
      </WordReviewHeader>
      <WordCheckFirst risks={review.risks} onJump={jump} />
      {large ? (
        <section className="word-plan-review__section">
          <div className="word-plan-review__toolbar">
            <h4>
              {t({
                id: "officeAddin.word.planReview.changes",
                message: "Changes",
              })}
            </h4>
            <SegmentedControl<GroupFilter>
              size="sm"
              value={filter}
              onChange={setFilter}
              aria-label={t({
                id: "officeAddin.word.planReview.sectionFilter",
                message: "Sections to show",
              })}
              options={[
                {
                  value: "changed",
                  label: t({
                    id: "officeAddin.word.planReview.onlyChanged",
                    message: "Only changed",
                  }),
                },
                {
                  value: "all",
                  label: t({
                    id: "officeAddin.word.planReview.all",
                    message: "All",
                  }),
                },
              ]}
            />
          </div>
          <ul className="word-plan-review__groups">
            {visibleGroups.map((group) => (
              <SectionGroup
                key={group.key}
                group={group}
                expanded={openGroups.has(group.key)}
                onToggle={() =>
                  toggle(setOpenGroups, group.key, !openGroups.has(group.key))
                }
                showUnchanged={filter === "all"}
                rowsProps={rowsProps}
              />
            ))}
          </ul>
        </section>
      ) : (
        <>
          {restructured && snapshot && (
            <section className="word-plan-review__section">
              <h4>
                {t({
                  id: "officeAddin.word.planReview.newVersion",
                  message: "New version",
                })}
              </h4>
              <WordPlanOutputPreview
                output={review.output ?? []}
                snapshot={snapshot}
                checkInWordShown={review.checkInWord}
              />
            </section>
          )}
          <PlanRows rows={bodyRows} {...rowsProps} />
          {review.size === "medium" && !restructured && snapshot && (
            <WordDisclosure
              className="word-plan-review__section"
              label={t({
                id: "officeAddin.word.planReview.showPreview",
                message: "Preview the result",
              })}
              openLabel={t({
                id: "officeAddin.word.planReview.hidePreview",
                message: "Hide preview",
              })}
            >
              <WordPlanOutputPreview
                output={review.output ?? []}
                snapshot={snapshot}
                checkInWordShown={review.checkInWord}
              />
            </WordDisclosure>
          )}
        </>
      )}
      {!!review.partsRows.length && (
        <section className="word-plan-review__section">
          <h4>
            {t({
              id: "officeAddin.word.planReview.documentParts",
              message: "Document parts",
            })}
          </h4>
          <PlanRows rows={review.partsRows} {...rowsProps} />
        </section>
      )}
      {review.checkInWord && (
        <p className="word-review__hint word-plan-review__hint">
          {t({
            id: "officeAddin.word.planReview.checkInWord",
            message:
              "Objects, pagination and page appearance are not drawn here. Check them in Word after applying.",
          })}
        </p>
      )}
    </div>
  );
}
