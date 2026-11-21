import { plural, t } from "@lingui/core/macro";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
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
  WordReviewHeader,
} from "./WordReviewCardParts";
import { formatList } from "./wordPlanLabels";

import type { WordAuthoringSnapshot } from "@/lib/wordReview/wordDocumentPlan";
import type {
  WordPartsProgress,
  WordPartsSectionRow,
  WordPartsStructure,
} from "@/lib/wordReview/wordPartsProgress";
import type {
  WordPlanRisk,
  WordPlanRow,
} from "@/lib/wordReview/wordPlanReview";
import type { ReactNode } from "react";

import "./wordReview.css";

/** Section plan rows (by number) and the reordering the user left out of Apply. */
export interface WordPartsLeftOut {
  rows: ReadonlySet<number>;
  structure: boolean;
}

export interface WordPartsReviewProps {
  progress: WordPartsProgress;
  title: string;
  /** Between Check first and the rows: the change's Apply, on top of the card. */
  top?: ReactNode;
  /** The review rows of what Apply writes, per section plan row; a row without them doesn't open. */
  changes?: ReadonlyMap<number, readonly WordPlanRow[]>;
  risks?: readonly WordPlanRisk[];
  snapshot?: WordAuthoringSnapshot;
  onLocate?: (ref: string) => void;
  locatable?: ReadonlySet<string>;
  /** Offers Leave out per row and for the reordering when set. */
  leftOut?: WordPartsLeftOut;
  onLeaveOut?: (target: number | "structure", out: boolean) => void;
  /** Hooks for the follow-up actions; without them the card says the step in words. */
  onRedo?: (row: WordPartsSectionRow) => void;
  onWriteMissing?: () => void;
  /** The change holds content only Word draws, as the plan review says. */
  checkInWord?: boolean;
}

type Shown = WordPartsSectionRow["state"] | "left-out" | "removed" | "written";

function pill(state: Shown): { label: string; tone: string } {
  switch (state) {
    case "waiting":
      return {
        label: t({ id: "officeAddin.word.parts.waiting", message: "Waiting" }),
        tone: WORD_PILL_TONE.neutral,
      };
    case "writing":
      return {
        label: t({ id: "officeAddin.word.parts.writing", message: "Writing…" }),
        tone: WORD_PILL_TONE.info,
      };
    case "checking":
      return {
        label: t({
          id: "officeAddin.word.parts.checking",
          message: "Checking…",
        }),
        tone: WORD_PILL_TONE.info,
      };
    case "ready":
      return {
        label: t({ id: "officeAddin.word.parts.ready", message: "Ready" }),
        tone: WORD_PILL_TONE.success,
      };
    case "written":
      return {
        label: t({ id: "officeAddin.word.parts.written", message: "Written" }),
        tone: WORD_PILL_TONE.neutral,
      };
    case "removed":
      // Neutral, not the plan rows' red: nothing on this card is red.
      return {
        label: planRowStatusLabel("removed"),
        tone: WORD_PILL_TONE.neutral,
      };
    case "not-written":
      return {
        label: t({
          id: "officeAddin.word.parts.notWritten",
          message: "Not written",
        }),
        tone: WORD_PILL_TONE.neutral,
      };
    case "changed-in-word":
    case "left-out":
      return {
        label: t({ id: "officeAddin.word.parts.leftOut", message: "Left out" }),
        tone: WORD_PILL_TONE.neutral,
      };
  }
}

const untitled = () =>
  t({ id: "officeAddin.word.parts.untitled", message: "Text without a title" });

function progressText(progress: WordPartsProgress): string | undefined {
  const rewrites = progress.rows.filter((row) => row.action === "rewrite");
  // A stopped change has nothing to apply, so it counts nothing as ready.
  if (progress.stopped) return undefined;
  if (progress.finishing)
    return t({
      id: "officeAddin.word.parts.finishing",
      message: "Checking the whole change…",
    });
  if (!rewrites.length) return undefined;
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

function structureSummary(structure: WordPartsStructure): string {
  const moves = structure.moves.length;
  const merges = structure.merges.length;
  const renames = structure.renames.length;
  return [
    moves &&
      t({
        id: "officeAddin.word.parts.moves",
        message: plural(moves, { one: "# move", other: "# moves" }),
      }),
    merges &&
      t({
        id: "officeAddin.word.parts.merges",
        message: plural(merges, { one: "# merge", other: "# merges" }),
      }),
    renames &&
      t({
        id: "officeAddin.word.parts.renames",
        message: plural(renames, {
          one: "# renamed heading",
          other: "# renamed headings",
        }),
      }),
  ]
    .filter(Boolean)
    .join(", ");
}

function structureLines(structure: WordPartsStructure): string[] {
  return [
    ...structure.moves.map(({ title, after, first }) => {
      const name = title || untitled();
      return first
        ? t({
            id: "officeAddin.word.parts.movesFirst",
            message: `${name} now comes first.`,
          })
        : after
          ? t({
              id: "officeAddin.word.parts.movesAfter",
              message: `${name} now comes after ${after}.`,
            })
          : t({
              id: "officeAddin.word.parts.movesElsewhere",
              message: `${name} moves to another place.`,
            });
    }),
    ...structure.merges.map(({ title }) => {
      const name = title || untitled();
      return t({
        id: "officeAddin.word.parts.merged",
        message: `Merged into one section: ${name}.`,
      });
    }),
    ...structure.renames.map(({ title, newTitle }) => {
      const name = title || untitled();
      return t({
        id: "officeAddin.word.parts.renamed",
        message: `${name} is renamed ${newTitle}.`,
      });
    }),
  ];
}

const MAX_NAMED = 3;

function namedRows(rows: readonly WordPartsSectionRow[]): string {
  const names = rows.map((row) => row.title || untitled());
  const more = names.length - MAX_NAMED;
  if (more <= 0) return formatList(names, "conjunction");
  const listed = formatList(names.slice(0, MAX_NAMED), "unit");
  return t({
    id: "officeAddin.word.parts.namedMore",
    message: plural(more, {
      one: `${listed} and # more section`,
      other: `${listed} and # more sections`,
    }),
  });
}

/**
 * A change in parts, row by row: the Structure row for what moves, then one row per section the
 * section plan rewrites or removes, each named by the document's own title. Rows fill while Erato
 * writes; once it finished, each opens to its changes and can be left out of Apply.
 */
export function WordPartsReview({
  progress,
  title,
  top,
  changes,
  risks = [],
  snapshot,
  onLocate,
  locatable,
  leftOut,
  onLeaveOut,
  onRedo,
  onWriteMissing,
  checkInWord = false,
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
  const structure = progress.structure;
  const merged = new Set(structure?.merges.map((merge) => merge.row));
  const reorders = !!structure?.moves.length || !!structure?.merges.length;
  const editable = !!leftOut && !!onLeaveOut;
  const reorderingOut = !!progress.reorderingLeftOut || !!leftOut?.structure;
  const leaveOutButton = (
    target: number | "structure",
    out: boolean,
    reordering = false,
  ) =>
    editable && (
      <div className="word-review__actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onLeaveOut(target, !out)}
        >
          {out
            ? reordering
              ? t({
                  id: "officeAddin.word.parts.includeReordering",
                  message: "Include the reordering again",
                })
              : t({
                  id: "officeAddin.word.parts.include",
                  message: "Include again",
                })
            : reordering
              ? t({
                  id: "officeAddin.word.parts.leaveOutReordering",
                  message: "Leave out the reordering",
                })
              : t({
                  id: "officeAddin.word.parts.leaveOut",
                  message: "Leave out",
                })}
        </Button>
      </div>
    );
  const withReordering = (row: WordPartsSectionRow) =>
    reorderingOut && merged.has(row.row);
  const isOut = (row: WordPartsSectionRow) =>
    row.state === "changed-in-word" ||
    withReordering(row) ||
    !!leftOut?.rows.has(row.row);
  const finished = progress.finished !== undefined;
  // "Apply the rest" only while something is left for Apply to write.
  const restApplies =
    finished &&
    (progress.rows.some((row) => row.state === "ready" && !isOut(row)) ||
      (!!structure && !reorderingOut));
  const notWritten = progress.rows.filter((row) => row.state === "not-written");
  const changedInWord = progress.rows.filter(
    (row) => row.state === "changed-in-word",
  );
  const gaps = namedRows(notWritten);
  const redone = namedRows(changedInWord);
  const status = progressText(progress);
  return (
    <div ref={containerRef} className="word-plan-review">
      <WordReviewHeader title={title} scope={progress.intent}>
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
      <ul
        className="word-parts__rows"
        aria-label={t({
          id: "officeAddin.word.parts.rows",
          message: "Sections",
        })}
      >
        {structure && (
          <WordReviewRow
            rowKey="structure"
            title={t({
              id: "officeAddin.word.parts.structure",
              message: "Structure",
            })}
            description={
              progress.reorderingLeftOut
                ? t({
                    id: "officeAddin.word.parts.reorderingChangedInWord",
                    message:
                      "Reordering replaces the whole document, which changed in Word meanwhile",
                  })
                : structureSummary(structure)
            }
            pill={
              // A stopped change applies nothing, so its planned structure has no state.
              !progress.stopped && (
                <Pill shown={reorderingOut ? "left-out" : "ready"} />
              )
            }
            open={open.has("structure")}
            onOpenChange={(next) => toggle(setOpen, "structure", next)}
            detail={
              <>
                <ul className="word-parts__lines">
                  {structureLines(structure).map((line, k) => (
                    <li key={k}>{line}</li>
                  ))}
                </ul>
                {!progress.reorderingLeftOut &&
                  leaveOutButton("structure", !!leftOut?.structure, reorders)}
              </>
            }
          />
        )}
        {progress.rows.map((row) => {
          const key = `row:${row.row}`;
          const name = row.title || untitled();
          const out = isOut(row);
          const rowChanges = changes?.get(row.row) ?? [];
          const canLeaveOut =
            row.state === "ready" && !withReordering(row) && editable;
          const redo = !!onRedo && row.state === "changed-in-word";
          const detail =
            rowChanges.length || canLeaveOut || redo ? (
              <>
                {!!rowChanges.length && (
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
                )}
                {canLeaveOut && leaveOutButton(row.row, out)}
                {redo && (
                  <div className="word-review__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onRedo(row)}
                    >
                      {t({
                        id: "officeAddin.word.parts.redo",
                        message: `Redo ${name}`,
                      })}
                    </Button>
                  </div>
                )}
              </>
            ) : undefined;
          return (
            <WordReviewRow
              key={key}
              rowKey={key}
              title={name}
              description={
                row.state === "changed-in-word"
                  ? t({
                      id: "officeAddin.word.parts.changedInWord",
                      message: "Changed in Word while Erato wrote it",
                    })
                  : withReordering(row)
                    ? t({
                        id: "officeAddin.word.parts.leftOutWithReordering",
                        message: "Left out with the reordering",
                      })
                    : undefined
              }
              pill={
                <Pill
                  shown={
                    out
                      ? "left-out"
                      : row.action === "delete" && row.state === "ready"
                        ? "removed"
                        : progress.stopped && row.state === "ready"
                          ? "written"
                          : row.state
                  }
                />
              }
              open={open.has(key)}
              onOpenChange={(next) => toggle(setOpen, key, next)}
              detail={detail}
            />
          );
        })}
      </ul>
      {(!!notWritten.length && (finished || progress.stopped)) ||
      (finished && !onRedo && !!changedInWord.length) ||
      (finished && !!progress.reorderingLeftOut) ? (
        <div className="word-plan-review__section word-parts__gap">
          {!!notWritten.length && (finished || progress.stopped) && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.parts.didntGetTo",
                message: `Erato didn't get to ${gaps}.`,
              })}{" "}
              {finished &&
                !onWriteMissing &&
                (restApplies
                  ? t({
                      id: "officeAddin.word.parts.writeMissingAfterApply",
                      message:
                        "Apply the rest, then ask Erato to write the missing sections.",
                    })
                  : t({
                      id: "officeAddin.word.parts.writeMissingNext",
                      message:
                        "Ask Erato to write the missing sections in your next message.",
                    }))}
            </p>
          )}
          {finished && !!notWritten.length && onWriteMissing && (
            <Button type="button" variant="secondary" onClick={onWriteMissing}>
              {t({
                id: "officeAddin.word.parts.writeMissing",
                message: "Write the missing sections",
              })}
            </Button>
          )}
          {finished && !onRedo && !!changedInWord.length && (
            <p className="word-review__hint">
              {restApplies
                ? t({
                    id: "officeAddin.word.parts.redoAfterApply",
                    message: `Apply the rest, then ask Erato to redo ${redone}.`,
                  })
                : t({
                    id: "officeAddin.word.parts.redoNext",
                    message: `Ask Erato to redo ${redone} in your next message.`,
                  })}
            </p>
          )}
          {finished && !!progress.reorderingLeftOut && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.parts.reorderAfterApply",
                message:
                  "Apply the rest, then ask Erato to reorder the sections again.",
              })}
            </p>
          )}
        </div>
      ) : null}
      {checkInWord && (
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

function Pill({ shown }: { shown: Shown }) {
  const { label, tone } = pill(shown);
  return <SettledInfoPill label={label} toneClassName={tone} />;
}
