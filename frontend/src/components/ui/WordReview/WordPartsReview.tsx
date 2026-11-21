import { plural, t } from "@lingui/core/macro";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { DisclosureChevron } from "@/components/ui/Controls/DisclosureChevron";
import { Row } from "@/components/ui/Controls/Row";
import { SettledInfoPill } from "@/components/ui/Trace/steps/ToolStatusPill";

import { WordPlanChangeRow } from "./WordPlanChangeRow";
import { WordCheckFirst } from "./WordReviewCardParts";
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
  /** Between the header and the rows: the change's Apply, on top of the card. */
  top?: ReactNode;
  /** The finished change's review rows per section plan row; a row without them doesn't open. */
  changes?: ReadonlyMap<number, readonly WordPlanRow[]>;
  risks?: readonly WordPlanRisk[];
  snapshot?: WordAuthoringSnapshot;
  onLocate?: (ref: string) => void;
  locatable?: ReadonlySet<string>;
  /** Offers Leave out per row and for the reordering when set. */
  leftOut?: WordPartsLeftOut;
  onLeaveOut?: (target: number | "structure", out: boolean) => void;
  /** Hooks for the follow-up actions; their buttons show only when set. */
  onRedo?: (row: WordPartsSectionRow) => void;
  onWriteMissing?: () => void;
  /** The change holds content only Word draws, as the plan review says. */
  checkInWord?: boolean;
}

const NEUTRAL = "bg-theme-bg-secondary text-theme-fg-secondary";
const SUCCESS = "bg-theme-success-bg text-theme-success-fg";
const INFO = "bg-theme-info-bg text-theme-info-fg";

type Shown = WordPartsSectionRow["state"] | "left-out" | "removed";

function pill(state: Shown): { label: string; tone: string } {
  switch (state) {
    case "waiting":
      return {
        label: t({ id: "officeAddin.word.parts.waiting", message: "Waiting" }),
        tone: NEUTRAL,
      };
    case "writing":
      return {
        label: t({ id: "officeAddin.word.parts.writing", message: "Writing…" }),
        tone: INFO,
      };
    case "checking":
      return {
        label: t({
          id: "officeAddin.word.parts.checking",
          message: "Checking…",
        }),
        tone: INFO,
      };
    case "ready":
      return {
        label: t({ id: "officeAddin.word.parts.ready", message: "Ready" }),
        tone: SUCCESS,
      };
    case "removed":
      return {
        label: t({ id: "officeAddin.word.parts.removed", message: "Removed" }),
        tone: NEUTRAL,
      };
    case "not-written":
      return {
        label: t({
          id: "officeAddin.word.parts.notWritten",
          message: "Not written",
        }),
        tone: NEUTRAL,
      };
    case "changed-in-word":
    case "left-out":
      return {
        label: t({ id: "officeAddin.word.parts.leftOut", message: "Left out" }),
        tone: NEUTRAL,
      };
  }
}

const untitled = () =>
  t({ id: "officeAddin.word.parts.untitled", message: "Text without a title" });

function progressText(progress: WordPartsProgress): string | undefined {
  const rewrites = progress.rows.filter((row) => row.action === "rewrite");
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

function PartsRow({
  rowKey,
  title,
  description,
  shown,
  detail,
  open,
  onOpenChange,
}: {
  rowKey: string;
  title: string;
  description?: string;
  shown: Shown;
  detail?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const { label, tone } = pill(shown);
  const trailing = <SettledInfoPill label={label} toneClassName={tone} />;
  if (!detail)
    return (
      <li className="word-review__row" data-parts-row={rowKey}>
        <Row
          variant="list"
          as="div"
          interactive={false}
          className="word-review__row-toggle"
          description={description}
          trailing={trailing}
        >
          {title}
        </Row>
      </li>
    );
  return (
    <li
      className={
        open ? "word-review__row word-review__row--open" : "word-review__row"
      }
      data-parts-row={rowKey}
    >
      <Row
        variant="list"
        as="button"
        className="word-review__row-toggle"
        aria-expanded={open}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- internal DOM id suffix
        aria-controls={`${id}-detail`}
        onClick={() => onOpenChange(!open)}
        leading={<DisclosureChevron open={open} />}
        description={description}
        trailing={trailing}
      >
        {title}
      </Row>
      {open && (
        <div id={`${id}-detail`} className="word-review__detail">
          {detail}
        </div>
      )}
    </li>
  );
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
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    if (!focusKey) return;
    const target = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ??
        [],
    ).find((item) => item.dataset.rowKey === focusKey);
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector
    const focusable = target?.querySelector<HTMLElement>("button, [tabindex]");
    focusable?.focus();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent in jsdom
    focusable?.scrollIntoView?.({ block: "nearest" });
    setFocusKey(null);
  }, [focusKey]);
  const toggle = (
    set: (update: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void,
    key: string,
    next: boolean,
  ) =>
    set((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(key);
      else copy.delete(key);
      return copy;
    });
  const jump = (rowKey: string) => {
    const owner = [...(changes ?? [])].find(([, rows]) =>
      rows.some((row) => row.key === rowKey),
    )?.[0];
    if (owner === undefined) return;
    toggle(setOpen, `row:${owner}`, true);
    toggle(setOpenChanges, rowKey, true);
    setFocusKey(rowKey);
  };
  const structure = progress.structure;
  const merged = new Set(structure?.merges.map((merge) => merge.row));
  const reorders = !!structure?.moves.length || !!structure?.merges.length;
  const editable = !!leftOut && !!onLeaveOut;
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
  const notWritten = progress.rows.filter((row) => row.state === "not-written");
  const gaps = namedRows(notWritten);
  const status = progressText(progress);
  return (
    <div ref={containerRef} className="word-plan-review">
      <div className="word-review__header">
        <h3>{title}</h3>
        {progress.intent && (
          <p className="word-review__hint">{progress.intent}</p>
        )}
        {status && (
          <p className="word-review__hint" role="status">
            {status}
          </p>
        )}
      </div>
      <div className="word-plan-review__section word-parts__top">{top}</div>
      <WordCheckFirst risks={risks} onJump={jump} />
      <ul
        className="word-parts__rows"
        aria-label={t({
          id: "officeAddin.word.parts.rows",
          message: "Sections",
        })}
      >
        {structure && (
          <PartsRow
            rowKey="structure"
            title={t({
              id: "officeAddin.word.parts.structure",
              message: "Structure",
            })}
            description={structureSummary(structure)}
            shown={leftOut?.structure ? "left-out" : "ready"}
            open={open.has("structure")}
            onOpenChange={(next) => toggle(setOpen, "structure", next)}
            detail={
              <>
                <ul className="word-parts__lines">
                  {structureLines(structure).map((line, k) => (
                    <li key={k}>{line}</li>
                  ))}
                </ul>
                {leaveOutButton("structure", !!leftOut?.structure, reorders)}
              </>
            }
          />
        )}
        {progress.rows.map((row) => {
          const key = `row:${row.row}`;
          const name = row.title || untitled();
          const withReordering = !!leftOut?.structure && merged.has(row.row);
          const out =
            row.state === "changed-in-word" ||
            withReordering ||
            !!leftOut?.rows.has(row.row);
          const rowChanges = changes?.get(row.row) ?? [];
          const canLeaveOut =
            row.state === "ready" && !withReordering && editable;
          const detail =
            rowChanges.length ||
            canLeaveOut ||
            (onRedo && row.state === "changed-in-word") ? (
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
                {onRedo && row.state === "changed-in-word" && (
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
            <PartsRow
              key={key}
              rowKey={key}
              title={name}
              description={
                row.state === "changed-in-word"
                  ? t({
                      id: "officeAddin.word.parts.changedInWord",
                      message: "Changed in Word while Erato wrote it",
                    })
                  : withReordering
                    ? t({
                        id: "officeAddin.word.parts.leftOutWithReordering",
                        message: "Left out with the reordering",
                      })
                    : undefined
              }
              shown={
                out
                  ? "left-out"
                  : row.action === "delete" && row.state === "ready"
                    ? "removed"
                    : row.state
              }
              open={open.has(key)}
              onOpenChange={(next) => toggle(setOpen, key, next)}
              detail={detail}
            />
          );
        })}
      </ul>
      {!!notWritten.length &&
        (progress.finished !== undefined || progress.stopped) && (
          <div className="word-plan-review__section word-parts__gap">
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.parts.didntGetTo",
                message: `Erato didn't get to ${gaps}.`,
              })}
            </p>
            {onWriteMissing && (
              <Button
                type="button"
                variant="secondary"
                onClick={onWriteMissing}
              >
                {t({
                  id: "officeAddin.word.parts.writeMissing",
                  message: "Write the missing sections",
                })}
              </Button>
            )}
          </div>
        )}
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
