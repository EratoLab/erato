import {
  Button,
  CheckIcon,
  DisclosureChevron,
  DocumentIcon,
  FileTextIcon,
  ImageIcon,
  MultiplePagesIcon,
  OpenNewWindowIcon,
  PageIcon,
  Row,
  SettledInfoPill,
  SpreadsheetIcon,
  TextComparison,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { nativeKindLabel } from "./WordNativeBlockPreview";
import { wordShowInWordLabel } from "./WordReviewCardParts";
import {
  CellTextEdit,
  WordChangeSide,
  WordRichBlockPreview,
  WordTablePreview,
} from "./WordRichBlockPreview";
import {
  bindingLabel,
  emptyPartLabel,
  formatList,
  formatWordLengths,
  layoutPropertyLabel,
  layoutValueLabel,
  storyLabel,
} from "./wordPlanLabels";
import { editExcerpt } from "../utils/wordEditPlan";

import type { WordAuthoringSnapshot } from "../utils/wordDocumentPlan";
import type {
  WordLayoutChange,
  WordPlanGroupStatus,
  WordPlanRow,
  WordPlanRowOf,
  WordPlanRowStatus,
} from "../utils/wordPlanReview";
import type { ComponentProps, ReactNode } from "react";

import "./wordReview.css";
import "./wordRichPreview.css";

export const PLAN_ROW_PREVIEW_ROWS = 5;

type PillStatus = WordPlanRowStatus | WordPlanGroupStatus;

export function planRowStatusLabel(status: PillStatus): string {
  switch (status) {
    case "rewritten":
      return t({
        id: "officeAddin.word.planRow.rewritten",
        message: "Rewritten",
      });
    case "new":
      return t({ id: "officeAddin.word.planRow.new", message: "New" });
    case "removed":
      return t({ id: "officeAddin.word.planRow.removed", message: "Removed" });
    case "changed":
      return t({ id: "officeAddin.word.planRow.changed", message: "Changed" });
    case "updated":
      return t({ id: "officeAddin.word.planRow.updated", message: "Updated" });
    case "kept":
      return t({ id: "officeAddin.word.planRow.kept", message: "Kept" });
    case "unchanged":
      return t({
        id: "officeAddin.word.planRow.unchanged",
        message: "Unchanged",
      });
  }
}
const STATUS_TONE: Partial<Record<PillStatus, string>> = {
  new: "bg-theme-success-bg text-theme-success-fg",
  removed: "bg-theme-error-bg text-theme-error-fg",
  kept: "bg-theme-bg-secondary text-theme-fg-secondary",
  unchanged: "bg-theme-bg-secondary text-theme-fg-secondary",
};
export function WordPlanStatusPill({ status }: { status: PillStatus }) {
  return (
    <SettledInfoPill
      label={planRowStatusLabel(status)}
      toneClassName={STATUS_TONE[status]}
    />
  );
}

const ICON = "size-4 shrink-0";
type RowRef = ComponentProps<typeof Row>["ref"];

interface RowProps<F extends WordPlanRow["family"]> {
  row: WordPlanRowOf<F>;
  snapshot?: WordAuthoringSnapshot;
}

interface ShellProps {
  row: WordPlanRow;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Omitted for one-line rows, which then render without a disclosure. */
  detail?: ReactNode;
  locate?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toggleRef?: RowRef;
}
function RowShell({
  row,
  icon,
  title,
  description,
  detail,
  locate,
  open,
  onOpenChange,
  toggleRef,
}: ShellProps) {
  const id = useId();
  const pill = row.status !== "unchanged" && (
    <WordPlanStatusPill status={row.status} />
  );
  if (detail === undefined)
    return (
      <li className="word-review__row" data-row-key={row.key}>
        <Row
          ref={toggleRef}
          variant="list"
          as="div"
          interactive={false}
          tabIndex={-1}
          className="word-review__row-toggle"
          leading={icon}
          description={description}
          trailing={
            <span className="word-plan-row__trailing">
              {locate}
              {pill}
            </span>
          }
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
      data-row-key={row.key}
    >
      <Row
        ref={toggleRef}
        variant="list"
        as="button"
        className="word-review__row-toggle"
        aria-expanded={open}
        aria-controls={`${id}-detail`}
        onClick={() => onOpenChange(!open)}
        leading={icon}
        description={description}
        trailing={
          <span className="word-plan-row__trailing">
            {pill}
            <DisclosureChevron open={open} />
          </span>
        }
      >
        {title}
      </Row>
      {open && (
        <div id={`${id}-detail`} className="word-review__detail">
          {locate}
          {detail}
        </div>
      )}
    </li>
  );
}

function blockTypeLabel(row: WordPlanRowOf<"text">): string {
  const level = row.level ?? row.beforeLevel;
  if (row.blockType === "heading" && level !== undefined)
    return t({
      id: "officeAddin.word.planRow.headingLevel",
      message: `Heading ${level}`,
    });
  if (row.blockType === "heading")
    return t({ id: "officeAddin.word.planRow.heading", message: "Heading" });
  if (row.blockType === "list-item")
    return t({ id: "officeAddin.word.planRow.listItem", message: "List item" });
  return t({ id: "officeAddin.word.planRow.paragraph", message: "Paragraph" });
}

function TextDetail({ row, snapshot }: RowProps<"text">) {
  const after = row.after?.text ?? "";
  const levelChange =
    row.beforeLevel !== undefined &&
    row.level !== undefined &&
    row.beforeLevel !== row.level ? (
      <p className="word-review__hint">
        {t({
          id: "officeAddin.word.planRow.levelChange",
          message: `Heading level ${row.beforeLevel} → ${row.level}`,
        })}
      </p>
    ) : null;
  if (row.before === undefined && row.after && snapshot)
    return <WordRichBlockPreview block={row.after} snapshot={snapshot} />;
  return (
    <>
      {levelChange}
      <TextComparison
        original={row.before ?? null}
        proposed={row.status === "removed" ? "" : after}
      />
    </>
  );
}

function tableSummary(row: WordPlanRowOf<"table">): string {
  const size = t({
    id: "officeAddin.word.planRow.tableSize",
    message: `${row.rows} × ${row.cols}`,
  });
  const cells = row.changedCells.length;
  const parts = [size];
  if (cells)
    parts.push(
      t({
        id: "officeAddin.word.planRow.cellsChanged",
        message: plural(cells, {
          one: "# cell changed",
          other: "# cells changed",
        }),
      }),
    );
  if (row.rowsAdded && row.status !== "new")
    parts.push(
      t({
        id: "officeAddin.word.planRow.rowsAdded",
        message: plural(row.rowsAdded, {
          one: "# row added",
          other: "# rows added",
        }),
      }),
    );
  if (row.rowsRemoved && row.status !== "removed")
    parts.push(
      t({
        id: "officeAddin.word.planRow.rowsRemoved",
        message: plural(row.rowsRemoved, {
          one: "# row removed",
          other: "# rows removed",
        }),
      }),
    );
  return parts.join(" · ");
}

function CellDiffTable({
  row,
  rowIndexes,
}: {
  row: WordPlanRowOf<"table">;
  rowIndexes: number[];
}) {
  const changed = new Map(
    row.changedCells.map((cell) => [`${cell.row}:${cell.col}`, cell]),
  );
  const cell = (r: number, c: number, text: string) => {
    const diff = changed.get(`${r}:${c}`);
    return diff ? (
      <CellTextEdit before={diff.before} after={diff.after} />
    ) : (
      <p className="word-rich-preview__text word-rich-preview__retained">
        {text}
      </p>
    );
  };
  const body = rowIndexes.filter((r) => r > 0);
  return (
    <div
      className="word-rich-preview__table-scroll"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll wide tables.
      tabIndex={0}
      role="region"
      aria-label={t({
        id: "officeAddin.word.planRow.changedRows",
        message: "Changed table rows",
      })}
    >
      <table className="docx-preview-theme word-rich-preview__paper word-rich-preview__table">
        <thead>
          <tr>
            {(row.cellTexts[0] ?? []).map((text, c) => (
              <th key={c} scope="col">
                {cell(0, c, text)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r) => (
            <tr key={r}>
              {(row.cellTexts[r] ?? []).map((text, c) => (
                <td key={c}>{cell(r, c, text)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableDetail({ row, snapshot }: RowProps<"table">) {
  if (row.sameShape)
    return <CellDiffTable row={row} rowIndexes={row.changedRowIndexes} />;
  if (row.block && snapshot)
    return (
      <>
        <WordTablePreview
          block={row.block}
          snapshot={snapshot}
          maxRows={PLAN_ROW_PREVIEW_ROWS}
        />
        {row.rows > PLAN_ROW_PREVIEW_ROWS && (
          <p className="word-review__hint">
            {t({
              id: "officeAddin.word.planRow.moreRows",
              message: plural(row.rows - PLAN_ROW_PREVIEW_ROWS, {
                one: "# more row in Word",
                other: "# more rows in Word",
              }),
            })}
          </p>
        )}
      </>
    );
  return (
    <CellDiffTable
      row={row}
      rowIndexes={Array.from(
        { length: Math.min(row.cellTexts.length, PLAN_ROW_PREVIEW_ROWS) },
        (_, i) => i,
      )}
    />
  );
}

function PartDetail({ row }: RowProps<"part">) {
  return (
    <TextComparison original={row.before ?? null} proposed={row.after ?? ""} />
  );
}

function layoutValues(change: WordLayoutChange): [string?, string?] {
  if (change.length) {
    const values = [change.before, change.after].filter(
      (v): v is number => typeof v === "number",
    );
    const formatted = formatWordLengths(values);
    return typeof change.before === "number"
      ? [formatted[0], formatted[1]]
      : [undefined, formatted[0]];
  }
  return [
    change.before === undefined
      ? undefined
      : layoutValueLabel(change.property, change.before),
    change.after === undefined
      ? undefined
      : layoutValueLabel(change.property, change.after),
  ];
}

function LayoutDetail({ row }: RowProps<"layout">) {
  return (
    <>
      {!row.beforeAvailable && (
        <p className="word-review__hint">
          {t({
            id: "officeAddin.word.planRow.beforeUnavailable",
            message:
              "Previous values were not captured; only the new settings are shown.",
          })}
        </p>
      )}
      <dl className="word-plan-row__layout">
        {row.changes.map((change) => {
          const [before, after] = layoutValues(change);
          return (
            <div key={change.property}>
              <dt>{layoutPropertyLabel(change.property)}</dt>
              <dd>
                {before !== undefined && row.beforeAvailable && (
                  <>
                    <del className="word-rich-preview__removed">
                      <WordChangeSide side="before" />
                      {before}
                    </del>
                    <span aria-hidden="true">{" → "}</span>
                    <WordChangeSide side="after" />
                  </>
                )}
                {after}
              </dd>
            </div>
          );
        })}
        {row.stories?.map((story) => (
          <div key={`${story.type}:${story.variant}`}>
            <dt>
              {storyLabel(story.type)} · {bindingLabel(story.variant)}
            </dt>
            <dd>{story.text ? editExcerpt(story.text) : emptyPartLabel()}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function unchangedLabel(row: WordPlanRowOf<"unchanged">): string {
  const parts = [
    row.paragraphs &&
      t({
        id: "officeAddin.word.planRow.paragraphCount",
        message: plural(row.paragraphs, {
          one: "# paragraph",
          other: "# paragraphs",
        }),
      }),
    row.tables &&
      t({
        id: "officeAddin.word.planRow.tableCount",
        message: plural(row.tables, { one: "# table", other: "# tables" }),
      }),
    row.objects &&
      t({
        id: "officeAddin.word.planRow.objectCount",
        message: plural(row.objects, {
          one: "# other item",
          other: "# other items",
        }),
      }),
  ].filter((part): part is string => !!part);
  const list = formatList(parts);
  return t({
    id: "officeAddin.word.planRow.unchangedRun",
    message: `${list} unchanged`,
  });
}

function layoutDescription(row: WordPlanRowOf<"layout">): string {
  if (row.status === "removed")
    return t({
      id: "officeAddin.word.planRow.sectionRemoved",
      message: "Section break removed",
    });
  const count = row.changes.length + (row.stories?.length ?? 0);
  return row.status === "new"
    ? t({
        id: "officeAddin.word.planRow.newSection",
        message: plural(count, {
          one: "New section · # setting",
          other: "New section · # settings",
        }),
      })
    : t({
        id: "officeAddin.word.planRow.settingsChanged",
        message: plural(count, {
          one: "# setting changed",
          other: "# settings changed",
        }),
      });
}

export interface WordPlanChangeRowProps {
  row: WordPlanRow;
  /** Absent for a saved plan preview: rows then render from plan data only. */
  snapshot?: WordAuthoringSnapshot;
  onLocate?: (ref: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  toggleRef?: RowRef;
}

/** One change in a document plan review; render inside a list. */
export function WordPlanChangeRow({
  row,
  snapshot,
  onLocate,
  open: controlledOpen,
  onOpenChange,
  toggleRef,
}: WordPlanChangeRowProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const ref = row.locateRef;
  const locatable =
    !!onLocate &&
    !!ref &&
    !!snapshot?.blocks.find((b) => b.ref === ref)?.paragraphOrdinal;
  const locate = locatable ? (
    <Button
      type="button"
      variant="link"
      className="word-review__locate"
      icon={<OpenNewWindowIcon className={ICON} />}
      onClick={() => onLocate(ref)}
    >
      {wordShowInWordLabel()}
    </Button>
  ) : undefined;
  const shell = {
    row,
    open,
    onOpenChange: setOpen,
    toggleRef,
    locate,
  };

  switch (row.family) {
    case "text": {
      const text = row.after?.text || row.before || "";
      return (
        <RowShell
          {...shell}
          icon={<FileTextIcon className={ICON} />}
          title={blockTypeLabel(row)}
          description={editExcerpt(text)}
          detail={<TextDetail row={row} snapshot={snapshot} />}
        />
      );
    }
    case "table":
      return (
        <RowShell
          {...shell}
          icon={<SpreadsheetIcon className={ICON} />}
          title={nativeKindLabel("table")}
          description={tableSummary(row)}
          detail={
            row.block || row.cellTexts.length ? (
              <TableDetail row={row} snapshot={snapshot} />
            ) : undefined
          }
        />
      );
    case "object":
      return (
        <RowShell
          {...shell}
          icon={
            row.objectKind === "image" || row.objectKind === "drawing" ? (
              <ImageIcon className={ICON} />
            ) : (
              <DocumentIcon className={ICON} />
            )
          }
          title={
            <>
              <strong>{nativeKindLabel(row.objectKind)}</strong>
              {row.name && <> · {row.name}</>}
            </>
          }
        />
      );
    case "part":
      return (
        <RowShell
          {...shell}
          icon={<PageIcon className={ICON} />}
          title={storyLabel(row.storyType)}
          description={
            row.bindings.length
              ? row.bindings.map(bindingLabel).join(" · ")
              : editExcerpt(row.after || row.before || "")
          }
          detail={<PartDetail row={row} />}
        />
      );
    case "layout":
      return (
        <RowShell
          {...shell}
          icon={<MultiplePagesIcon className={ICON} />}
          title={t({
            id: "officeAddin.word.planRow.pageLayout",
            message: "Page layout",
          })}
          description={layoutDescription(row)}
          detail={
            row.changes.length || row.stories?.length ? (
              <LayoutDetail row={row} />
            ) : undefined
          }
        />
      );
    case "unchanged":
      return (
        <RowShell
          {...shell}
          locate={undefined}
          icon={<CheckIcon className={ICON} />}
          title={unchangedLabel(row)}
        />
      );
  }
}
