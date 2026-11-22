import { plural, t } from "@lingui/core/macro";
import { useRef, useState } from "react";

import { SettledInfoPill } from "@/components/ui/Trace/steps/ToolStatusPill";

import {
  planRowStatusLabel,
  WORD_PILL_TONE,
  WordPlanChangeRow,
  WordReviewRow,
} from "./WordPlanChangeRow";
import {
  toggledKeys,
  useWordReviewJumpFocus,
  WordCheckFirst,
  WordNotChangedLine,
  WordReviewHeader,
} from "./WordReviewCardParts";

import type { WordAuthoringSnapshot } from "@/lib/wordReview/wordDocumentPlan";
import type {
  WordPartsProgress,
  WordPartsSectionRow,
} from "@/lib/wordReview/wordPartsProgress";
import type {
  WordPlanRisk,
  WordPlanRow,
} from "@/lib/wordReview/wordPlanReview";
import type { ReactNode } from "react";

import "./wordReview.css";

export interface WordPartsReviewProps {
  progress: WordPartsProgress;
  /** The card's heading; the intent goes under it unless it is the heading. */
  title: string;
  /** Between Check first and the rows: the change's Apply, on top of the card. */
  top?: ReactNode;
  /** The review rows of what Apply writes, per section plan row; a row without them doesn't open. */
  changes?: ReadonlyMap<number, readonly WordPlanRow[]>;
  risks?: readonly WordPlanRisk[];
  snapshot?: WordAuthoringSnapshot;
  onLocate?: (ref: string) => void;
  locatable?: ReadonlySet<string>;
  /** Further parts the proposal leaves as they were, by title, named after the card's own rows. */
  notChanged?: readonly string[];
}

/** What the card says from the section plan's first streamed arguments until the pane accepts it. */
export const wordPartsPlanningText = () =>
  t({
    id: "officeAddin.word.parts.planning",
    message: "Erato is planning the changes…",
  });

/** In place of the route above Apply when the change moves or merges sections. */
export const wordPartsReorderingText = () =>
  t({
    id: "officeAddin.word.parts.reordering",
    message:
      "Reordering replaces the whole document; Undo takes it back only as a whole.",
  });

type Mark = "writing" | "ready" | "removed" | "moved" | "renamed";

function pill(mark: Mark): { label: string; tone: string } {
  switch (mark) {
    case "writing":
      return {
        label: t({ id: "officeAddin.word.parts.writing", message: "Writing…" }),
        tone: WORD_PILL_TONE.info,
      };
    case "ready":
      return {
        label: t({ id: "officeAddin.word.parts.ready", message: "Ready" }),
        tone: WORD_PILL_TONE.success,
      };
    case "removed":
      // Neutral, not the plan rows' red: nothing on this card is red.
      return {
        label: planRowStatusLabel("removed"),
        tone: WORD_PILL_TONE.neutral,
      };
    case "moved":
      return {
        label: t({ id: "officeAddin.word.parts.moved", message: "Moved" }),
        tone: WORD_PILL_TONE.neutral,
      };
    case "renamed":
      return {
        label: t({ id: "officeAddin.word.parts.renamed", message: "Renamed" }),
        tone: WORD_PILL_TONE.neutral,
      };
  }
}

const untitled = () =>
  t({ id: "officeAddin.word.parts.untitled", message: "Text without a title" });

/** Once finished, a row whose part did not go in stays as it was, and a merge goes with a
 * reordering the finish left out, since it joins blocks from other places. */
const keptAsItWas = (progress: WordPartsProgress) => {
  const merged = new Set(progress.structure?.merged);
  return (row: WordPartsSectionRow) =>
    progress.finished !== undefined &&
    (row.state !== "ready" ||
      (!!progress.reorderingLeftOut && merged.has(row.row)));
};

/** The rows the card lists: every row while Erato writes, only those that change once finished. */
const listedRows = (progress: WordPartsProgress) => {
  const kept = keptAsItWas(progress);
  return progress.rows.filter((row) => !kept(row));
};

/** The card's heading, the same while Erato writes and once finished; undefined without rows. */
export function wordPartsTitleText(
  progress: WordPartsProgress,
): string | undefined {
  const count = listedRows(progress).length;
  return count
    ? t({
        id: "officeAddin.word.parts.title",
        message: plural(count, {
          one: "Changes in # section",
          other: "Changes in # sections",
        }),
      })
    : undefined;
}

function progressText(progress: WordPartsProgress): string | undefined {
  const rewrites = progress.rows.filter((row) => row.action === "rewrite");
  // A stopped change has nothing to apply and a finished one lists only what changes.
  if (progress.stopped || progress.finished !== undefined || !rewrites.length)
    return undefined;
  const ready = rewrites.filter((row) => row.state === "ready").length;
  const total = rewrites.length;
  return t({
    id: "officeAddin.word.parts.progress",
    message: plural(total, {
      one: `${ready} of # section ready`,
      other: `${ready} of # sections ready`,
    }),
  });
}

/** A change in parts: the intent, the count, and each section by its own title, marked writing or
 * ready; once finished, only the sections that change, and one line names what stays as it was. */
export function WordPartsReview({
  progress,
  title,
  top,
  changes,
  risks = [],
  snapshot,
  onLocate,
  locatable,
  notChanged = [],
}: WordPartsReviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [openChanges, setOpenChanges] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const setFocusKey = useWordReviewJumpFocus(containerRef);
  const toggle = (
    set: (update: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void,
    key: string,
    next: boolean,
  ) => set((prev) => toggledKeys(prev, key, next));
  const ownerOf = (rowKey: string) =>
    [...(changes ?? [])].find(([, rows]) =>
      rows.some((row) => row.key === rowKey),
    )?.[0];
  const jump = (rowKey: string) => {
    const owner = ownerOf(rowKey);
    if (owner === undefined) return;
    toggle(setOpen, `row:${owner}`, true);
    toggle(setOpenChanges, rowKey, true);
    setFocusKey(rowKey);
  };
  const finished = progress.finished !== undefined;
  const renamed = new Set(progress.structure?.renamed);
  const unchanged = keptAsItWas(progress);
  const listed = progress.rows.filter((row) => !unchanged(row));
  // Once finished every listed section is ready, so only what moves, renames or goes is marked.
  const mark = (row: WordPartsSectionRow): Mark | undefined =>
    progress.stopped
      ? undefined
      : row.state !== "ready"
        ? "writing"
        : row.action === "delete"
          ? "removed"
          : row.action === "keep"
            ? renamed.has(row.row)
              ? "renamed"
              : "moved"
            : finished
              ? undefined
              : "ready";
  const changedInWord = () =>
    t({
      id: "officeAddin.word.parts.reasonChangedInWord",
      message: "changed in Word",
    });
  const named = (name: string, reason?: string) =>
    reason
      ? t({
          id: "officeAddin.word.parts.withReason",
          message: `${name} (${reason})`,
        })
      : name;
  const unchangedRows = progress.rows.filter(unchanged);
  const gaps = [
    ...(finished && progress.reorderingLeftOut
      ? [
          named(
            t({
              id: "officeAddin.word.parts.order",
              message: "the order of the sections",
            }),
            changedInWord(),
          ),
        ]
      : []),
    ...unchangedRows.map((row) =>
      named(
        row.title || untitled(),
        row.state === "changed-in-word" ? changedInWord() : undefined,
      ),
    ),
    ...notChanged.filter(
      (name) => !unchangedRows.some((row) => row.title === name),
    ),
  ];
  const status = progressText(progress);
  return (
    <div ref={containerRef} className="word-plan-review">
      <WordReviewHeader
        title={title}
        scope={progress.intent === title ? undefined : progress.intent}
      >
        {status && (
          <p className="word-review__hint" role="status">
            {status}
          </p>
        )}
      </WordReviewHeader>
      <WordCheckFirst
        risks={risks}
        onJump={jump}
        jumpable={(rowKey) => ownerOf(rowKey) !== undefined}
      />
      {top && (
        <div className="word-plan-review__section word-parts__top">{top}</div>
      )}
      <WordNotChangedLine names={gaps} className="word-plan-review__hint" />
      {listed.length > 0 && (
        <ul
          className="word-parts__rows"
          aria-label={t({
            id: "officeAddin.word.parts.rows",
            message: "Sections",
          })}
        >
          {listed.map((row) => {
            const key = `row:${row.row}`;
            const rowChanges = changes?.get(row.row) ?? [];
            const shown = mark(row);
            return (
              <WordReviewRow
                key={key}
                rowKey={key}
                title={row.title || untitled()}
                pill={shown && <Pill mark={shown} />}
                open={open.has(key)}
                onOpenChange={(next) => toggle(setOpen, key, next)}
                detail={
                  rowChanges.length ? (
                    <ul className="word-review__list word-parts__changes">
                      {rowChanges.map((change) => (
                        <WordPlanChangeRow
                          key={change.key}
                          row={change}
                          snapshot={snapshot}
                          onLocate={onLocate}
                          locatable={
                            !!change.locateRef &&
                            !!locatable?.has(change.locateRef)
                          }
                          open={openChanges.has(change.key)}
                          onOpenChange={(next) =>
                            toggle(setOpenChanges, change.key, next)
                          }
                        />
                      ))}
                    </ul>
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Pill({ mark }: { mark: Mark }) {
  const { label, tone } = pill(mark);
  return <SettledInfoPill label={label} toneClassName={tone} />;
}
