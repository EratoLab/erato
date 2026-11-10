import clsx from "clsx";
import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import {
  changeLayout,
  collapsedNames,
  hidesMachineId,
  MAX_FIRST_VIEW_BATCH_FIELDS,
  MAX_FIRST_VIEW_ROWS,
  TEXT_LINES,
} from "@/lib/toolCallGist/change";
import {
  batchDeletionsLine,
  batchDifferentLine,
  batchFieldLine,
  batchFieldsMore,
  batchLossLines,
  batchOperationsLine,
  batchRestInDetails,
  batchRowLabel,
  batchSameLine,
  batchSeeMore,
  beingEmptiedLabel,
  changeNamesOnly,
  changeNoteLabel,
  changeSeeMoreLine,
  changeSummaryLine,
  cutValuePhrase,
  dryRunLabel,
  emptiedLabel,
  emptiedWasLabel,
  emptyValuePhrase,
  everyRecordLine,
  fieldsInDetails,
  filterEmptyPart,
  filterLabel,
  flagsLabel,
  foundLine,
  incompleteLines,
  linkPhrase,
  listAddedLabel,
  listAddsClaim,
  listKeptLabel,
  listRemovedLabel,
  listReplacedLine,
  listSetLabel,
  machineIdPhrase,
  opaqueCutLine,
  outsideLine,
  plainChangeValue,
  recipientKindWord,
  recipientsLine,
  recipientsSeeAll,
  textHeading,
  textOldLabel,
  textSeeAll,
  uncheckedLine,
  writeInsideReadLine,
} from "@/lib/toolCallGist/changeLabels";
import { gistWarningLabel } from "@/lib/toolCallGist/gistLabels";
import { SCROLL_BOX_CLASS, scrollBoxProps } from "@/lib/toolCallGist/scrollBox";

import { ToolCallGistLine } from "./ToolCallGist";
import { Collapse } from "../Controls/Collapse";
import { DisclosureButton } from "../Controls/Disclosure";

import type {
  ChangeBatch,
  ChangeBatchRow,
  ChangeEffect,
  ChangeOpaque,
  ChangeRecipients,
  ChangeText,
  ChangeValue,
  GistChange,
} from "@/lib/toolCallGist/change";
import type { Gist, GistPhase } from "@/lib/toolCallGist/gist";
import type { ScrollBoxKind } from "@/lib/toolCallGist/scrollBox";
import type { ReactNode, Ref } from "react";

const ISOLATED = "[unicode-bidi:isolate]";
const MUTED = "text-xs text-theme-fg-muted";
const LIST_VALUES = 6;
/** Values named under a trace row; the rest are counted. */
const ROW_VALUES = 2;

/**
 * A box that scrolls when its content does not fit. Only then is it a tab
 * stop and a named group, so a long card keeps a short keyboard path.
 */
const ScrollBox = ({
  kind,
  className,
  children,
  as: Component = "div",
  ...rest
}: {
  kind: ScrollBoxKind;
  className?: string;
  children: ReactNode;
  as?: "div" | "p";
  "data-testid"?: string;
}) => {
  const ref = useRef<HTMLElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const check = () => {
      setOverflows(element.scrollHeight > element.clientHeight + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [children]);
  return (
    <Component
      ref={ref as Ref<never>}
      {...(overflows ? scrollBoxProps(kind) : {})}
      className={clsx(SCROLL_BOX_CLASS, className)}
      {...rest}
    >
      {children}
    </Component>
  );
};

const SeeMore = ({
  label,
  defaultOpen = false,
  hint,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  /** Shown only while closed. */
  hint?: ReactNode;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div data-testid="tool-call-change-see-more" data-open={open}>
      <DisclosureButton
        open={open}
        controls={id}
        onToggle={() => {
          setOpen(!open);
        }}
      >
        <span className="text-start text-xs [overflow-wrap:anywhere]">
          {label}
        </span>
      </DisclosureButton>
      {!open && hint}
      <Collapse isOpen={open}>
        <div id={id} className="space-y-1 pt-1">
          {open && children}
        </div>
      </Collapse>
    </div>
  );
};

/** Name above value in a narrow pane, side by side where there is room. */
const Row = ({ name, children }: { name: string; children: ReactNode }) => (
  <div
    className="flex flex-wrap gap-x-3 text-xs"
    data-testid="tool-call-change-row"
  >
    <span
      dir="auto"
      className={clsx(
        "min-w-0 basis-40 break-words text-theme-fg-muted",
        ISOLATED,
      )}
    >
      {name}
    </span>
    <div className="min-w-0 flex-1 basis-56 break-words text-theme-fg-primary [overflow-wrap:anywhere]">
      {children}
    </div>
  </div>
);

const ValueText = ({
  value,
  link = false,
}: {
  value: ChangeValue;
  link?: boolean;
}) => {
  if (hidesMachineId(value)) {
    return (
      <span className="text-theme-fg-muted" data-origin="hidden-id">
        {link ? linkPhrase(undefined) : machineIdPhrase()}
      </span>
    );
  }
  if (value.text.length === 0) {
    return (
      <span className="text-theme-fg-muted">
        {value.truncated ? cutValuePhrase() : emptyValuePhrase()}
      </span>
    );
  }
  const shown = value.truncated ? `${value.text}…` : value.text;
  return (
    <span
      dir="auto"
      data-origin={value.machineId ? "resolved" : "written"}
      className={ISOLATED}
    >
      {link ? linkPhrase(shown) : shown}
    </span>
  );
};

const ValueList = ({
  values,
  omitted = 0,
  limit = LIST_VALUES,
}: {
  values: ChangeValue[];
  omitted?: number;
  limit?: number;
}) => {
  const shown = values.slice(0, limit);
  const more = values.length - shown.length + omitted;
  return (
    <>
      {shown.map((value, index) => (
        <Fragment key={index}>
          {index > 0 && ", "}
          <ValueText value={value} />
        </Fragment>
      ))}
      {more > 0 && <span className="text-theme-fg-muted"> +{more}</span>}
    </>
  );
};

const EffectValue = ({ effect }: { effect: ChangeEffect }) => {
  if (effect.values.length === 0) {
    return (
      <span className="text-theme-fg-muted">
        {effect.effect === "unreadable" ? cutValuePhrase() : emptyValuePhrase()}
      </span>
    );
  }
  return (
    <>
      {effect.old && (
        <>
          <span
            dir="auto"
            data-testid="tool-call-change-old"
            className={clsx(
              "underline decoration-dotted underline-offset-2",
              ISOLATED,
            )}
          >
            <ValueText value={effect.old} />
          </span>
          <span aria-hidden="true" className="px-1 text-theme-fg-muted">
            →
          </span>
        </>
      )}
      {effect.values.length === 1 ? (
        <ValueText value={effect.values[0]} link={effect.link} />
      ) : (
        <ValueList values={effect.values} omitted={effect.omitted} />
      )}
    </>
  );
};

const ValueRow = ({
  effect,
  showRawName = false,
  claim,
}: {
  effect: ChangeEffect;
  showRawName?: boolean;
  /** What the tool claims about this value, so the card says whose word it is. */
  claim?: string;
}) => (
  <Row name={effect.name}>
    <ScrollBox kind="value" className="max-h-24">
      <EffectValue effect={effect} />
    </ScrollBox>
    {claim !== undefined && (
      <p className={MUTED} data-testid="tool-call-change-claim">
        {claim}
      </p>
    )}
    {showRawName &&
      effect.rawName.length > 0 &&
      effect.rawName !== effect.name && (
        <p
          dir="auto"
          className={clsx(
            "font-mono text-[0.7rem] text-theme-fg-muted",
            ISOLATED,
          )}
        >
          {effect.rawName}
        </p>
      )}
  </Row>
);

const emptiedText = (effect: ChangeEffect): string =>
  effect.old
    ? emptiedWasLabel(effect.name, plainChangeValue(effect.old))
    : effect.name;

const EmptiedRow = ({ effects }: { effects: ChangeEffect[] }) =>
  effects.length === 0 ? null : (
    <div data-testid="tool-call-change-emptied">
      <Row name={emptiedLabel()}>
        <span dir="auto" className={ISOLATED}>
          {effects.map(emptiedText).join(", ")}
        </span>
      </Row>
    </div>
  );

const ListRow = ({ effect }: { effect: ChangeEffect }) => (
  <div className="space-y-0.5" data-testid="tool-call-change-list">
    {effect.removed.length > 0 ? (
      <>
        <p className="text-xs text-theme-fg-primary">
          {listReplacedLine(
            effect.name,
            effect.removed.length,
            effect.kept.length,
          )}
        </p>
        <Row name={listRemovedLabel(effect.name)}>
          <ValueList values={effect.removed} limit={MAX_FIRST_VIEW_ROWS * 4} />
        </Row>
        {effect.kept.length > 0 && (
          <Row name={listKeptLabel(effect.name)}>
            <ValueList values={effect.kept} />
          </Row>
        )}
        {effect.added.length > 0 && (
          <Row name={listAddedLabel(effect.name)}>
            <ValueList values={effect.added} />
          </Row>
        )}
      </>
    ) : (
      <Row name={listSetLabel(effect.name)}>
        <ValueList values={effect.values} omitted={effect.omitted} />
      </Row>
    )}
  </div>
);

const RecipientsPart = ({ recipients }: { recipients: ChangeRecipients }) => (
  <div className="space-y-1" data-testid="tool-call-change-recipients">
    <p className="text-xs font-medium text-theme-fg-primary">
      {recipientsLine(recipients)}
    </p>
    {recipients.outsideKnown && recipients.outside.length > 0 && (
      <Alert type="warning" role="none" data-testid="tool-call-change-outside">
        <span dir="auto" className={ISOLATED}>
          {outsideLine(recipients)}
        </span>
      </Alert>
    )}
    {recipients.outsideKnown && recipients.unchecked > 0 && (
      <p className={MUTED}>{uncheckedLine(recipients.unchecked)}</p>
    )}
    {recipients.groups.some((group) => group.values.length > 0) && (
      <SeeMore label={recipientsSeeAll(recipients.total)}>
        {recipients.groups.map((group, index) => (
          <Row key={index} name={recipientKindWord(group.kind)}>
            <ScrollBox kind="value" className="max-h-24">
              <span dir="auto" className={ISOLATED}>
                {group.values.join(", ")}
              </span>
              {group.omitted > 0 && (
                <span className="text-theme-fg-muted"> +{group.omitted}</span>
              )}
            </ScrollBox>
          </Row>
        ))}
      </SeeMore>
    )}
  </div>
);

const FilterPart = ({
  filter,
}: {
  filter: NonNullable<GistChange["filter"]>;
}) => {
  if (filter.everyRecord) {
    return (
      <Alert
        type="warning"
        role="none"
        data-testid="tool-call-change-every-record"
      >
        {everyRecordLine()}
      </Alert>
    );
  }
  if (!filter.text && filter.parts.length === 0 && filter.omitted === 0) {
    return null;
  }
  return (
    <div data-testid="tool-call-change-filter">
      <Row name={filterLabel()}>
        {filter.text ? (
          <ValueText value={filter.text} />
        ) : (
          filter.parts.map((part, index) => (
            <Fragment key={index}>
              {index > 0 && ", "}
              {part.isEmpty ? (
                <span dir="auto" className={ISOLATED}>
                  {filterEmptyPart(part.name)}
                </span>
              ) : (
                <>
                  <span dir="auto" className={ISOLATED}>
                    {part.name}
                  </span>{" "}
                  <ValueText value={part.value} />
                </>
              )}
            </Fragment>
          ))
        )}
        {filter.omitted > 0 && (
          <span className="text-theme-fg-muted"> +{filter.omitted}</span>
        )}
      </Row>
    </div>
  );
};

const FlagsPart = ({ flags }: { flags: GistChange["flags"] }) => (
  <div data-testid="tool-call-change-flags">
    <Row name={flagsLabel()}>
      <span className="flex flex-wrap gap-1">
        {flags.map((flag, index) => (
          <span
            key={index}
            dir="auto"
            className={clsx("rounded bg-theme-bg-secondary px-1.5", ISOLATED)}
          >
            {flag.dryRun ? dryRunLabel(flag.name) : flag.name}
          </span>
        ))}
      </span>
    </Row>
  </div>
);

const OpaquePart = ({ opaque }: { opaque: ChangeOpaque }) => (
  <div className="space-y-1" data-testid="tool-call-change-opaque">
    {opaque.found.length > 0 && (
      <Alert type="warning" role="none" data-testid="tool-call-change-found">
        {foundLine(opaque.kind, opaque.found)}
        {opaque.writeInsideRead && <> {writeInsideReadLine()}</>}
      </Alert>
    )}
    <ScrollBox
      kind="value"
      className="max-h-40 rounded bg-theme-bg-secondary p-2 font-mono text-xs text-theme-fg-primary"
      data-testid="tool-call-change-statement"
    >
      <span
        dir="auto"
        className={clsx(
          "whitespace-pre-wrap [overflow-wrap:anywhere]",
          ISOLATED,
        )}
      >
        {opaque.truncated ? `${opaque.text}…` : opaque.text}
      </span>
    </ScrollBox>
    {opaque.truncated && <p className={MUTED}>{opaqueCutLine()}</p>}
  </div>
);

const TextPart = ({
  entry,
  replaced,
}: {
  entry: ChangeText;
  replaced: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const hiddenLines = Math.max(entry.lines - TEXT_LINES, 0);
  const collapsible = hiddenLines > 0;
  return (
    <div className="space-y-1" data-testid="tool-call-change-text">
      <p className="text-xs text-theme-fg-primary">
        <span dir="auto" className={ISOLATED}>
          {textHeading(entry.name, entry.lines, entry.chars, replaced)}
        </span>
      </p>
      {entry.before && (
        <div className="space-y-0.5">
          <p className={MUTED}>{textOldLabel()}</p>
          <p
            dir="auto"
            className={clsx(
              "max-h-24 overflow-hidden whitespace-pre-wrap text-xs text-theme-fg-muted line-through [overflow-wrap:anywhere]",
              ISOLATED,
            )}
          >
            {entry.before.text}
          </p>
        </div>
      )}
      <div id={id}>
        {collapsible && !open ? (
          <p
            dir="auto"
            className={clsx(
              "line-clamp-6 whitespace-pre-wrap text-xs text-theme-fg-primary [overflow-wrap:anywhere]",
              ISOLATED,
            )}
            data-testid="tool-call-change-text-start"
          >
            {entry.text}
          </p>
        ) : (
          <ScrollBox
            kind="value"
            className="max-h-64 whitespace-pre-wrap text-xs text-theme-fg-primary [overflow-wrap:anywhere]"
            as="p"
          >
            <span dir="auto" className={ISOLATED}>
              {entry.text}
            </span>
          </ScrollBox>
        )}
      </div>
      {collapsible && (
        <DisclosureButton
          open={open}
          controls={id}
          onToggle={() => {
            setOpen(!open);
          }}
        >
          <span className="text-xs">{textSeeAll(hiddenLines)}</span>
        </DisclosureButton>
      )}
      {entry.truncated && <p className={MUTED}>{cutValuePhrase()}</p>}
    </div>
  );
};

/** A value's old → new as plain text, for a row that shows a few in one line. */
const rowChangeText = (effect: ChangeEffect): string => {
  const value = effect.values.map(plainChangeValue).join(", ");
  return effect.old
    ? `${effect.name} ${plainChangeValue(effect.old)} → ${value}`
    : `${effect.name} ${value}`;
};

const batchEffectText = (effect: ChangeEffect): string =>
  effect.effect === "emptied"
    ? beingEmptiedLabel(effect.name)
    : rowChangeText(effect);

const BatchRow = ({ row }: { row: ChangeBatchRow }) => (
  <li className="space-y-0.5" data-testid="tool-call-change-batch-row">
    <p
      dir="auto"
      className={clsx("text-xs font-medium text-theme-fg-primary", ISOLATED)}
    >
      {batchRowLabel(row)}
    </p>
    {row.effects.length > 0 && (
      <p
        dir="auto"
        className={clsx(
          "break-words text-xs text-theme-fg-secondary [overflow-wrap:anywhere]",
          ISOLATED,
        )}
      >
        {row.effects.map(batchEffectText).join(" · ")}
        {row.effectsOmitted > 0 && (
          <span className="text-theme-fg-muted"> +{row.effectsOmitted}</span>
        )}
      </p>
    )}
  </li>
);

const BatchFields = ({ batch }: { batch: ChangeBatch }) => {
  const shown = batch.fields.slice(0, MAX_FIRST_VIEW_BATCH_FIELDS);
  const more = batch.fields.length - shown.length + batch.fieldsOmitted;
  return shown.length === 0 ? null : (
    <div className="space-y-0.5" data-testid="tool-call-change-batch-fields">
      {shown.map((field, index) => (
        <Row key={index} name={field.name}>
          <span dir="auto" className={ISOLATED}>
            {batchFieldLine(field, batch.total)}
          </span>
        </Row>
      ))}
      {more > 0 && <p className={MUTED}>{batchFieldsMore(more)}</p>}
    </div>
  );
};

const BatchPart = ({ batch }: { batch: ChangeBatch }) => {
  const deleted = batch.rows
    .filter((row) => row.action === "delete")
    .slice(0, 3)
    .map(batchRowLabel);
  const first = batch.rows.slice(0, MAX_FIRST_VIEW_ROWS);
  const rest = batch.rows.slice(MAX_FIRST_VIEW_ROWS);
  const unstored = batch.total - batch.rows.length;
  const losses = batchLossLines(batch);
  const seeMoreCount = batch.sameChange
    ? batch.total
    : batch.total - first.length;
  return (
    <div className="space-y-1" data-testid="tool-call-change-batch">
      {batch.operations.length > 1 && (
        <p className="text-xs text-theme-fg-primary">
          {batchOperationsLine(batch)}
        </p>
      )}
      {batch.deletions > 0 && (
        <Alert
          type="warning"
          role="none"
          data-testid="tool-call-change-deletions"
        >
          <span dir="auto" className={ISOLATED}>
            {batchDeletionsLine(batch.deletions, deleted)}
          </span>
        </Alert>
      )}
      {losses.map((line, index) => (
        <p
          key={index}
          className="text-xs text-theme-fg-primary"
          data-testid="tool-call-change-batch-loss"
        >
          {line}
        </p>
      ))}
      {batch.sameChange ? (
        <>
          <p className="text-xs text-theme-fg-primary">{batchSameLine()}</p>
          <div className="space-y-0.5">
            {batch.shared.map((effect, index) => (
              <ValueRow key={index} effect={effect} />
            ))}
          </div>
        </>
      ) : (
        <>
          <BatchFields batch={batch} />
          <p className={MUTED}>{batchDifferentLine()}</p>
          <ul className="space-y-1">
            {first.map((row) => (
              <BatchRow key={row.number} row={row} />
            ))}
          </ul>
        </>
      )}
      {seeMoreCount > 0 && batch.rows.length > 0 && (
        <SeeMore label={batchSeeMore(seeMoreCount)}>
          <ul className="space-y-1">
            {(batch.sameChange ? batch.rows : rest).map((row) => (
              <BatchRow key={row.number} row={row} />
            ))}
          </ul>
          {unstored > 0 && (
            <p className={MUTED}>{batchRestInDetails(unstored)}</p>
          )}
        </SeeMore>
      )}
    </div>
  );
};

/** What the call loses or the card cannot read: above any long text or SQL. */
const LossesPart = ({ change }: { change: GistChange }) => {
  const layout = changeLayout(change);
  return (
    <>
      <EmptiedRow effects={layout.emptied} />
      {layout.lists.map((effect, index) => (
        <ListRow key={index} effect={effect} />
      ))}
      {layout.unreadable.map((effect, index) => (
        <ValueRow key={index} effect={effect} />
      ))}
    </>
  );
};

const ValuesPart = ({ change }: { change: GistChange }) => {
  const layout = changeLayout(change);
  const collapsedTotal = layout.collapsed.length + layout.beyondCap;
  const { shown, more } = collapsedNames(layout.collapsed.map((e) => e.name));
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
  const addsOnly = change.notes.includes("tool_says_adds_to_list");
  const claimOf = (effect: ChangeEffect) =>
    addsOnly && effect.list ? listAddsClaim() : undefined;
  return (
    <>
      {layout.firstRows.map((effect, index) => (
        <ValueRow key={index} effect={effect} claim={claimOf(effect)} />
      ))}
      {collapsedTotal > 0 && (
        <SeeMore
          label={changeSeeMoreLine(change, layout)}
          defaultOpen={layout.opensByDefault}
          hint={
            shown.length > 0 ? (
              <p className={MUTED} data-testid="tool-call-change-names">
                <span dir="auto" className={ISOLATED}>
                  {changeNamesOnly(shown.join(", "), more)}
                </span>
              </p>
            ) : undefined
          }
        >
          {layout.collapsed.map((effect, index) => (
            <ValueRow
              key={index}
              effect={effect}
              showRawName
              claim={claimOf(effect)}
            />
          ))}
          {layout.beyondCap > 0 && (
            <p className={MUTED}>{fieldsInDetails(layout.beyondCap)}</p>
          )}
        </SeeMore>
      )}
    </>
  );
};

const ChangeNotes = ({ change }: { change: GistChange }) => {
  const notes = change.notes
    .map(changeNoteLabel)
    .filter((text) => text.length > 0);
  return notes.length === 0 ? null : (
    <div className="space-y-0.5" data-testid="tool-call-change-notes">
      {notes.map((text, index) => (
        <p key={index} className={MUTED}>
          {text}
        </p>
      ))}
    </div>
  );
};

/**
 * Under a trace row, what the call did in a line or two: counts live in the
 * row's title, so this names the losses, who it reached and the first values.
 */
export const ToolCallChangeRowDetails = ({
  change,
}: {
  change: GistChange;
}) => {
  const layout = changeLayout(change);
  const shown = layout.firstRows.slice(0, ROW_VALUES);
  const more = layout.firstRows.length - shown.length + layout.collapsed.length;
  const found = change.opaque.flatMap((opaque) =>
    opaque.found.length > 0 ? [foundLine(opaque.kind, opaque.found)] : [],
  );
  const removals = layout.lists.filter((effect) => effect.removed.length > 0);
  return (
    <div
      className="space-y-0.5 text-xs text-theme-fg-secondary"
      data-testid="tool-call-change-row-details"
    >
      {change.recipients && (
        <p>
          {recipientsLine(change.recipients)}
          {change.recipients.outsideKnown &&
            change.recipients.outside.length > 0 && (
              <span dir="auto" className={ISOLATED}>
                {" · "}
                {outsideLine(change.recipients)}
              </span>
            )}
        </p>
      )}
      {change.batch && change.batch.deletions > 0 && (
        <p dir="auto" className={ISOLATED}>
          {batchDeletionsLine(change.batch.deletions, [])}
        </p>
      )}
      {change.batch &&
        (change.batch.rowsEmptying > 0 ||
          change.batch.rowsReplacingLists > 0) &&
        batchLossLines(change.batch).map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      {layout.emptied.length > 0 && (
        <p dir="auto" className={ISOLATED}>
          {emptiedLabel()}: {layout.emptied.map(emptiedText).join(", ")}
        </p>
      )}
      {removals.map((effect, index) => (
        <p key={index} dir="auto" className={ISOLATED}>
          {listRemovedLabel(effect.name)}:{" "}
          {effect.removed.map(plainChangeValue).join(", ")}
        </p>
      ))}
      {found.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
      {shown.length > 0 && (
        <p dir="auto" className={ISOLATED}>
          {shown.map(rowChangeText).join(", ")}
          {more > 0 && <span className="text-theme-fg-muted"> +{more}</span>}
        </p>
      )}
    </div>
  );
};

/** Whether a trace row has more to say than its line and counts. */
export const changeRowHasDetails = (change: GistChange): boolean => {
  const layout = changeLayout(change);
  return (
    change.recipients !== undefined ||
    (change.batch?.deletions ?? 0) > 0 ||
    (change.batch?.rowsEmptying ?? 0) > 0 ||
    (change.batch?.rowsReplacingLists ?? 0) > 0 ||
    layout.emptied.length > 0 ||
    layout.firstRows.length > 0 ||
    layout.lists.some((effect) => effect.removed.length > 0) ||
    change.opaque.some((opaque) => opaque.found.length > 0)
  );
};

const IncompleteAlert = ({ change }: { change: GistChange }) =>
  change.complete ? null : (
    <Alert type="warning" role="none" data-testid="tool-call-change-incomplete">
      {incompleteLines(change).map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </Alert>
  );

/**
 * What a change description says beyond a card's line: who it reaches, what
 * is lost and what cannot be read first, then statements and long text, then
 * the values. A call with no verb lists its values in its own argument view,
 * so `values` leaves them out there.
 */
export const ToolCallChangeBody = ({
  change,
  replacesText = false,
  values = true,
}: {
  change: GistChange;
  replacesText?: boolean;
  values?: boolean;
}) => (
  <div className="space-y-2" data-testid="tool-call-change-body">
    <IncompleteAlert change={change} />
    {change.recipients && <RecipientsPart recipients={change.recipients} />}
    {change.filter && <FilterPart filter={change.filter} />}
    {change.flags.length > 0 && <FlagsPart flags={change.flags} />}
    {values && <LossesPart change={change} />}
    {change.opaque.map((opaque, index) => (
      <OpaquePart key={index} opaque={opaque} />
    ))}
    {change.batch && <BatchPart batch={change.batch} />}
    {change.texts.map((entry, index) => (
      <TextPart key={index} entry={entry} replaced={replacesText} />
    ))}
    {values && <ValuesPart change={change} />}
    <ChangeNotes change={change} />
  </div>
);

/**
 * What an approval card shows for a call with a change description: the
 * sentence, then who it reaches, what is lost and what the card cannot read,
 * and at most five changed values; the rest behind one line that says what
 * it holds. What the card warns about stays on top and the buttons below stay
 * close, in one bounded box as on any other card.
 */
export const ToolCallChangeCard = ({
  gist,
  change,
  phase,
  notes,
}: {
  gist: Gist;
  change: GistChange;
  phase: GistPhase;
  notes?: ReactNode;
}) => {
  const summary = changeSummaryLine(change);
  return (
    <div className="space-y-2" data-testid="tool-call-gist">
      {gist.warnings.map((warning) => (
        <Alert key={warning} type="warning" role="none">
          {gistWarningLabel(warning)}
        </Alert>
      ))}
      {notes}
      <ScrollBox
        kind="card"
        className="max-h-[50vh] min-w-0 space-y-2"
        data-testid="tool-call-gist-scroll"
      >
        {gist.items.map((item, index) => (
          <p
            key={index}
            className="break-words text-sm font-medium text-theme-fg-primary [overflow-wrap:anywhere]"
            data-testid="tool-call-gist-line"
          >
            <ToolCallGistLine
              gist={gist}
              item={item}
              phase={phase}
              variant="card"
            />
          </p>
        ))}
        {summary !== undefined && <p className={MUTED}>{summary}</p>}
        <ToolCallChangeBody
          change={change}
          replacesText={gist.action === "update" || gist.action === "upsert"}
        />
      </ScrollBox>
    </div>
  );
};
