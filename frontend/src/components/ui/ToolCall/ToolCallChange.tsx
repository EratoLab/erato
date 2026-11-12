import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import { StatusPill } from "@/components/ui/Feedback/StatusPill";
import {
  effectDisplayName,
  headlineItemOf,
  notePlacesOf,
  OLD_VALUES_NOTE,
  showsEarlierValues,
} from "@/lib/toolCallGist/cardLayout";
import {
  changeLayout,
  collapsedNames,
  hidesMachineId,
  listReplaceIsUnknown,
  MAX_FIRST_VIEW_BATCH_FIELDS,
  MAX_FIRST_VIEW_ROWS,
  TEXT_LINES,
  toolSaysOnlyAdds,
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
  changeNoteLabel,
  changeSeeMoreLine,
  changeSummaryLine,
  CODE_SLOT,
  CODED_SLOTS,
  codedValueFrame,
  codedValueText,
  cutValuePhrase,
  dryRunLabel,
  earlierValuesFootnote,
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
  listRemovesClaim,
  listSetLabel,
  listWouldGoLabel,
  listWouldStayLabel,
  machineIdPhrase,
  MEANING_SLOT,
  newNamePhrase,
  opaqueCutLine,
  outsideBadgeLabel,
  outsideLine,
  plainChangeValue,
  recipientKindWord,
  recipientsLine,
  recipientsSeeAll,
  seeMoreWithNames,
  shareWithLabel,
  textHeading,
  textOldLabel,
  textSeeAll,
  toolTitleLabel,
  uncheckedLine,
  unreadableLabel,
  writeInsideReadLine,
} from "@/lib/toolCallGist/changeLabels";
import {
  gistUnreadRecordLine,
  gistWarningLabel,
  namesOnlyAnItem,
  showsUnreadRecord,
} from "@/lib/toolCallGist/gistLabels";
import { SCROLL_BOX_CLASS, scrollBoxProps } from "@/lib/toolCallGist/scrollBox";
import {
  NEW_TEXT_CLASS,
  NEW_VALUE_CLASS,
  OLD_TEXT_CLASS,
  OLD_VALUE_CLASS,
} from "@/lib/toolCallGist/valueStyle";

import { headlineClass, ToolCallGistLine } from "./ToolCallGist";
import { Collapse } from "../Controls/Collapse";
import { DisclosureButton } from "../Controls/Disclosure";

import type { ToolCallChangeNote } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
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
import type { Gist, GistAction, GistPhase } from "@/lib/toolCallGist/gist";
import type { ScrollBoxKind } from "@/lib/toolCallGist/scrollBox";
import type { ReactNode, Ref } from "react";

const ISOLATED = "[unicode-bidi:isolate]";
/** Provenance, footnotes and claims under a row: the smallest, quietest step. */
const MUTED = "text-xs text-theme-fg-muted";
const LIST_VALUES = 6;
/** Values named under a trace row; the rest are counted. */
const ROW_VALUES = 2;
/** Option chips and statements sit on the card, so they need a colour of their own. */
const ON_CARD = "border border-theme-border bg-theme-bg-tertiary";

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
        <span className="text-start text-sm [overflow-wrap:anywhere]">
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

/**
 * Name and value side by side where there is room, which on a phone is most
 * short rows; name above value only in a narrower pane.
 */
const Row = ({ name, children }: { name: string; children: ReactNode }) => (
  <div
    className="flex flex-wrap gap-x-3 text-sm"
    data-testid="tool-call-change-row"
  >
    <span
      dir="auto"
      className={clsx(
        "min-w-0 basis-28 break-words text-theme-fg-secondary sm:basis-40",
        ISOLATED,
      )}
    >
      {name}
    </span>
    <div className="min-w-0 flex-1 basis-40 break-words text-theme-fg-primary [overflow-wrap:anywhere] sm:basis-56">
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
  // The tool's word is greyed around the meaning, so the meaning reads first.
  const frame =
    value.meaning && value.meaning.source !== "glossary" && !link
      ? codedValueFrame(value)
      : undefined;
  const text = codedValueText(value);
  const shown = value.truncated ? `${text}…` : text;
  // A meaning read from an earlier result looks like any other earlier value.
  const earlier = value.meaning?.source === "earlier";
  return (
    <span
      dir="auto"
      data-origin={
        earlier ? "earlier" : value.machineId ? "resolved" : "written"
      }
      title={
        earlier
          ? t({
              id: "toolGist.value.earlier",
              message: "Value from an earlier result in this chat",
            })
          : undefined
      }
      className={clsx(
        ISOLATED,
        earlier && "underline decoration-dotted underline-offset-2",
      )}
    >
      {frame
        ? frame.split(CODED_SLOTS).map((part, index) =>
            part === CODE_SLOT ? (
              <Fragment key={index}>
                {value.text}
                {value.truncated && "…"}
              </Fragment>
            ) : part === MEANING_SLOT ? (
              <Fragment key={index}>{value.meaning?.label}</Fragment>
            ) : part.length > 0 ? (
              <span key={index} className="text-theme-fg-muted">
                {part}
              </span>
            ) : null,
          )
        : link
          ? linkPhrase(shown)
          : shown}
    </span>
  );
};

/** An old value struck through in red and the new one in green, on any theme. */
const OldToNew = ({
  old,
  arrow,
  children,
}: {
  old: ChangeValue;
  /** A row line reads as text: its arrow stays a plain character there. */
  arrow: "text" | "spoken";
  children: ReactNode;
}) => (
  <>
    <span
      dir="auto"
      data-testid="tool-call-change-old"
      className={clsx(OLD_VALUE_CLASS, ISOLATED)}
    >
      <ValueText value={old} />
    </span>
    {arrow === "spoken" ? (
      <>
        <span aria-hidden="true" className="px-1 text-theme-fg-muted">
          →
        </span>
        <span className="sr-only">
          {t({ id: "toolGist.changesTo", message: "changes to" })}
        </span>
      </>
    ) : (
      " → "
    )}
    <span
      dir="auto"
      data-testid="tool-call-change-new"
      className={clsx(NEW_VALUE_CLASS, ISOLATED)}
    >
      {children}
    </span>
  </>
);

const ValueList = ({
  values,
  omitted = 0,
  limit = LIST_VALUES,
  valueClassName,
}: {
  values: ChangeValue[];
  omitted?: number;
  limit?: number;
  /** Each value's own style, such as an old value's. */
  valueClassName?: string;
}) => {
  const shown = values.slice(0, limit);
  const more = values.length - shown.length + omitted;
  return (
    <>
      {shown.map((value, index) => (
        <Fragment key={index}>
          {index > 0 && ", "}
          {valueClassName ? (
            <span className={valueClassName}>
              <ValueText value={value} />
            </span>
          ) : (
            <ValueText value={value} />
          )}
        </Fragment>
      ))}
      {more > 0 && <span className="text-theme-fg-muted"> +{more}</span>}
    </>
  );
};

/** "set to" before a name given to a record nobody read, so it never reads as that record's name. */
const NewName = ({ effect }: { effect: ChangeEffect }) =>
  effect.newName ? (
    <span
      className="text-theme-fg-muted"
      data-testid="tool-call-change-new-name"
    >
      {newNamePhrase()}{" "}
    </span>
  ) : null;

const EffectValue = ({ effect }: { effect: ChangeEffect }) => {
  if (effect.values.length === 0) {
    return (
      <span className="text-theme-fg-muted">
        {effect.effect === "unreadable" ? cutValuePhrase() : emptyValuePhrase()}
      </span>
    );
  }
  const value =
    effect.values.length === 1 ? (
      <ValueText value={effect.values[0]} link={effect.link} />
    ) : (
      <ValueList values={effect.values} omitted={effect.omitted} />
    );
  // An unchanged value has no old → new to show: it stays what it is.
  return effect.old && effect.effect !== "unchanged" ? (
    <OldToNew old={effect.old} arrow="spoken">
      {value}
    </OldToNew>
  ) : (
    <>
      <NewName effect={effect} />
      {value}
    </>
  );
};

/** A list the tool says gains or loses items is named for what it does. */
const effectName = (effect: ChangeEffect): string => {
  switch (effect.effect) {
    case "list_added":
      return listAddedLabel(effect.name);
    case "list_removed":
      return listRemovedLabel(effect.name);
    default:
      return effectDisplayName(effect);
  }
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
  <Row name={effectName(effect)}>
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
      effect.rawName !== effect.name &&
      // A glossary name already carries the raw name beside it.
      !effect.name.endsWith(`(${effect.rawName})`) && (
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

const ListRow = ({
  effect,
  replaceUnknown,
}: {
  effect: ChangeEffect;
  /** Whether it is unknown if the call replaces the list or adds to it. */
  replaceUnknown: boolean;
}) => (
  <div className="space-y-1" data-testid="tool-call-change-list">
    {effect.removed.length > 0 ? (
      <>
        <Row
          name={
            replaceUnknown
              ? listWouldGoLabel(effect.name)
              : listRemovedLabel(effect.name)
          }
        >
          <ValueList
            values={effect.removed}
            limit={MAX_FIRST_VIEW_ROWS * 4}
            valueClassName={replaceUnknown ? undefined : OLD_VALUE_CLASS}
          />
        </Row>
        {effect.kept.length > 0 && (
          <Row
            name={
              replaceUnknown
                ? listWouldStayLabel(effect.name)
                : listKeptLabel(effect.name)
            }
          >
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
      <Row name={replaceUnknown ? effect.name : listSetLabel(effect.name)}>
        <ValueList values={effect.values} omitted={effect.omitted} />
      </Row>
    )}
  </div>
);

/** Items the tool says the call removes from a list: a loss, and the tool's word. */
const RemovedFromListRow = ({ effect }: { effect: ChangeEffect }) => (
  <div className="space-y-1" data-testid="tool-call-change-list">
    <Row name={listRemovedLabel(effect.name)}>
      <ValueList
        values={effect.values}
        omitted={effect.omitted}
        limit={MAX_FIRST_VIEW_ROWS * 4}
      />
      <p className={MUTED} data-testid="tool-call-change-claim">
        {listRemovesClaim()}
      </p>
    </Row>
  </div>
);

/** Recipients a card lists by address in their rows, without a count above them. */
const MAX_INLINE_RECIPIENTS = 3;

const addressKey = (text: string) => text.trim().toLowerCase();

/**
 * Whether every recipient is listed by address, and every one outside the
 * organisation among them, so the rows can carry the outside mark.
 */
const listsRecipientsInline = (recipients: ChangeRecipients): boolean => {
  const listed = recipients.groups.flatMap((group) => group.values);
  if (
    recipients.total === 0 ||
    recipients.total > MAX_INLINE_RECIPIENTS ||
    listed.length !== recipients.total ||
    recipients.groups.some(
      (group) => group.omitted > 0 || group.values.length !== group.count,
    ) ||
    recipients.outsideOmitted > 0
  ) {
    return false;
  }
  const keys = new Set(listed.map(addressKey));
  return recipients.outside.every((address) => keys.has(addressKey(address)));
};

/** One to three recipients: each by address, the outside ones marked on the address. */
const InlineRecipients = ({
  recipients,
  action,
}: {
  recipients: ChangeRecipients;
  action: GistAction | undefined;
}) => {
  const outside = new Set(
    recipients.outsideKnown ? recipients.outside.map(addressKey) : [],
  );
  return (
    <div className="space-y-1" data-testid="tool-call-change-recipients">
      {recipients.groups
        .filter((group) => group.values.length > 0)
        .map((group, index) => (
          <Row
            key={index}
            name={
              action === "share"
                ? shareWithLabel()
                : recipientKindWord(group.kind)
            }
          >
            <ul className="space-y-1">
              {group.values.map((address, at) => (
                <li
                  key={at}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <span dir="auto" className={clsx(ISOLATED, "min-w-0")}>
                    {address}
                  </span>
                  {outside.has(addressKey(address)) && (
                    <span data-testid="tool-call-change-outside-badge">
                      <StatusPill tone="warning">
                        {outsideBadgeLabel()}
                      </StatusPill>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Row>
        ))}
      {recipients.outsideKnown && recipients.unchecked > 0 && (
        <p className={MUTED}>{uncheckedLine(recipients.unchecked)}</p>
      )}
    </div>
  );
};

/** From four on: the count by To, Cc and Bcc, every outside address named, the rest behind one control. */
const CountedRecipients = ({
  recipients,
}: {
  recipients: ChangeRecipients;
}) => (
  <div className="space-y-1" data-testid="tool-call-change-recipients">
    <p className="text-sm font-semibold text-theme-fg-primary">
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

const RecipientsPart = ({
  recipients,
  action,
}: {
  recipients: ChangeRecipients;
  action: GistAction | undefined;
}) =>
  listsRecipientsInline(recipients) ? (
    <InlineRecipients recipients={recipients} action={action} />
  ) : (
    <CountedRecipients recipients={recipients} />
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
            className={clsx("rounded px-1.5", ON_CARD, ISOLATED)}
          >
            {flag.dryRun ? dryRunLabel(flag.name) : flag.name}
          </span>
        ))}
      </span>
    </Row>
  </div>
);

/** Notes said under the row or statement they are about. */
const NoteLines = ({
  notes,
  className = MUTED,
}: {
  notes: readonly ToolCallChangeNote[];
  className?: string;
}) => (
  <>
    {notes.map((note) => (
      <p
        key={note}
        className={className}
        data-testid="tool-call-change-row-note"
      >
        {changeNoteLabel(note)}
      </p>
    ))}
  </>
);

/**
 * A statement the call runs, with what was found in it above it; an
 * instruction reads as the quoted content it is, with what Erato does not ask
 * about under it.
 */
const OpaquePart = ({
  opaque,
  notes,
}: {
  opaque: ChangeOpaque;
  notes: readonly ToolCallChangeNote[];
}) => {
  const text = opaque.truncated ? `${opaque.text}…` : opaque.text;
  const isInstruction = opaque.kind === "instruction";
  return (
    <div className="space-y-1" data-testid="tool-call-change-opaque">
      {opaque.found.length > 0 && (
        <Alert type="warning" role="none" data-testid="tool-call-change-found">
          {foundLine(opaque.kind, opaque.found)}
          {opaque.writeInsideRead && <> {writeInsideReadLine()}</>}
        </Alert>
      )}
      {isInstruction ? (
        <ScrollBox
          kind="value"
          className="max-h-40 border-l-2 border-theme-border py-0.5 pl-3 text-sm text-theme-fg-primary"
          data-testid="tool-call-change-statement"
        >
          <blockquote
            dir="auto"
            className={clsx(
              "whitespace-pre-wrap [overflow-wrap:anywhere]",
              ISOLATED,
            )}
          >
            {text}
          </blockquote>
        </ScrollBox>
      ) : (
        <ScrollBox
          kind="value"
          className={clsx(
            "max-h-40 rounded p-2 font-mono text-xs text-theme-fg-primary",
            ON_CARD,
          )}
          data-testid="tool-call-change-statement"
        >
          <span
            dir="auto"
            className={clsx(
              "whitespace-pre-wrap [overflow-wrap:anywhere]",
              ISOLATED,
            )}
          >
            {text}
          </span>
        </ScrollBox>
      )}
      {opaque.truncated && <p className={MUTED}>{opaqueCutLine()}</p>}
      <NoteLines
        notes={notes}
        className={isInstruction ? "text-sm text-theme-fg-secondary" : MUTED}
      />
    </div>
  );
};

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
  const newTextClass = entry.before ? NEW_TEXT_CLASS : "text-theme-fg-primary";
  const heading = textHeading(entry.name, entry.lines, entry.chars, replaced);
  // A short text reads as a row like any other value.
  if (heading === entry.name && !entry.before && !collapsible) {
    return (
      <div data-testid="tool-call-change-text">
        <Row name={entry.name}>
          <ScrollBox
            kind="value"
            className="max-h-24 whitespace-pre-wrap"
            as="p"
          >
            <span dir="auto" className={ISOLATED}>
              {entry.text}
            </span>
          </ScrollBox>
          {entry.truncated && <p className={MUTED}>{cutValuePhrase()}</p>}
        </Row>
      </div>
    );
  }
  return (
    <div className="space-y-1" data-testid="tool-call-change-text">
      <p className="text-sm text-theme-fg-secondary">
        <span dir="auto" className={ISOLATED}>
          {heading}
        </span>
      </p>
      {entry.before && (
        <div className="space-y-0.5">
          <p className={MUTED}>{textOldLabel()}</p>
          <p
            dir="auto"
            className={clsx(
              "max-h-24 overflow-hidden whitespace-pre-wrap text-sm [overflow-wrap:anywhere]",
              OLD_TEXT_CLASS,
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
              "line-clamp-6 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]",
              newTextClass,
              ISOLATED,
            )}
            data-testid="tool-call-change-text-start"
          >
            {entry.text}
          </p>
        ) : (
          <ScrollBox
            kind="value"
            className={clsx(
              "max-h-64 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]",
              newTextClass,
            )}
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
          <span className="text-sm">{textSeeAll(hiddenLines)}</span>
        </DisclosureButton>
      )}
      {entry.truncated && <p className={MUTED}>{cutValuePhrase()}</p>}
    </div>
  );
};

/** A value's old → new, for a row that shows a few in one line. */
const RowChange = ({ effect }: { effect: ChangeEffect }) => {
  const value = effect.values.map(plainChangeValue).join(", ");
  return (
    <>
      {effectName(effect)}{" "}
      {effect.old && effect.effect !== "unchanged" ? (
        <OldToNew old={effect.old} arrow="text">
          {value}
        </OldToNew>
      ) : (
        <>
          <NewName effect={effect} />
          {value}
        </>
      )}
    </>
  );
};

const BatchEffect = ({ effect }: { effect: ChangeEffect }) =>
  effect.effect === "emptied" ? (
    <>{beingEmptiedLabel(effect.name)}</>
  ) : (
    <RowChange effect={effect} />
  );

const BatchRow = ({ row }: { row: ChangeBatchRow }) => (
  <li className="space-y-0.5" data-testid="tool-call-change-batch-row">
    <p
      dir="auto"
      className={clsx("text-sm font-semibold text-theme-fg-primary", ISOLATED)}
    >
      {batchRowLabel(row)}
    </p>
    {row.effects.length > 0 && (
      <p
        dir="auto"
        className={clsx(
          "break-words text-sm text-theme-fg-secondary [overflow-wrap:anywhere]",
          ISOLATED,
        )}
      >
        {row.effects.map((effect, index) => (
          <Fragment key={index}>
            {index > 0 && " · "}
            <BatchEffect effect={effect} />
          </Fragment>
        ))}
        {row.effectsOmitted > 0 && (
          <span className="text-theme-fg-muted"> +{row.effectsOmitted}</span>
        )}
      </p>
    )}
  </li>
);

const BatchFields = ({
  batch,
  listsMaybeReplaced,
}: {
  batch: ChangeBatch;
  listsMaybeReplaced: boolean;
}) => {
  const shown = batch.fields.slice(0, MAX_FIRST_VIEW_BATCH_FIELDS);
  const more = batch.fields.length - shown.length + batch.fieldsOmitted;
  return shown.length === 0 ? null : (
    <div className="space-y-1" data-testid="tool-call-change-batch-fields">
      {shown.map((field, index) => (
        <Row key={index} name={field.name}>
          <span dir="auto" className={ISOLATED}>
            {batchFieldLine(field, batch.total, listsMaybeReplaced)}
          </span>
        </Row>
      ))}
      {more > 0 && <p className={MUTED}>{batchFieldsMore(more)}</p>}
    </div>
  );
};

/** Rows that lose something first, then updates, then what is new. */
const lossRank = (row: ChangeBatchRow): number => {
  if (row.action === "delete") return 0;
  if (
    row.effects.some(
      (effect) =>
        effect.effect === "emptied" ||
        effect.effect === "list_removed" ||
        effect.effect === "list_replaced",
    )
  ) {
    return 1;
  }
  return row.action === "create" ? 3 : 2;
};

const NAMED_DELETIONS = 3;

const BatchPart = ({
  batch,
  listsMaybeReplaced,
  onlyAdds,
  operationsInHeadline,
}: {
  batch: ChangeBatch;
  listsMaybeReplaced: boolean;
  onlyAdds: boolean;
  /** The card's headline says the operations already. */
  operationsInHeadline: boolean;
}) => {
  const named = batch.rows
    .filter((row) => row.action === "delete")
    .slice(0, NAMED_DELETIONS);
  const deleted = named.map(batchRowLabel);
  // A deletion the warning names, with nothing else to say, is no row again.
  const sayAlready = new Set(
    named
      .filter((row) => row.effects.length === 0 && row.effectsOmitted === 0)
      .map((row) => row.number),
  );
  const listed = batch.rows
    .filter((row) => !sayAlready.has(row.number))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => lossRank(a.row) - lossRank(b.row) || a.index - b.index)
    .map(({ row }) => row);
  const first = listed.slice(0, MAX_FIRST_VIEW_ROWS);
  const rest = listed.slice(MAX_FIRST_VIEW_ROWS);
  const unstored = batch.total - batch.rows.length;
  const rowsInView =
    !batch.sameChange &&
    unstored === 0 &&
    rest.length === 0 &&
    first.every((row) => row.effectsOmitted === 0);
  const losses = batchLossLines(
    batch,
    listsMaybeReplaced,
    onlyAdds,
    rowsInView,
  );
  const seeMoreCount = batch.sameChange ? batch.total : rest.length + unstored;
  return (
    <div className="space-y-1" data-testid="tool-call-change-batch">
      {batch.operations.length > 1 && !operationsInHeadline && (
        <p className="text-sm font-semibold text-theme-fg-primary">
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
          className="text-sm text-theme-fg-primary"
          data-testid="tool-call-change-batch-loss"
        >
          {line}
        </p>
      ))}
      {batch.sameChange ? (
        <>
          <p className="text-sm text-theme-fg-primary">{batchSameLine()}</p>
          <div className="space-y-1">
            {batch.shared.map((effect, index) => (
              <ValueRow key={index} effect={effect} />
            ))}
          </div>
        </>
      ) : (
        <>
          {!rowsInView && (
            <>
              <BatchFields
                batch={batch}
                listsMaybeReplaced={listsMaybeReplaced}
              />
              <p className={MUTED}>{batchDifferentLine()}</p>
            </>
          )}
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
  const { lists } = notePlacesOf(change);
  const rows =
    layout.emptied.length +
    layout.lists.length +
    layout.removedFromLists.length +
    layout.unreadable.length;
  return rows === 0 ? null : (
    <div className="space-y-1" data-testid="tool-call-change-losses">
      <EmptiedRow effects={layout.emptied} />
      {layout.lists.map((effect, index) => (
        <ListRow
          key={index}
          effect={effect}
          replaceUnknown={listReplaceIsUnknown(change)}
        />
      ))}
      {layout.lists.length > 0 && <NoteLines notes={lists} />}
      {layout.removedFromLists.map((effect, index) => (
        <RemovedFromListRow key={index} effect={effect} />
      ))}
      {layout.unreadable.map((effect, index) => (
        <ValueRow key={index} effect={effect} />
      ))}
    </div>
  );
};

/** What the tool claims about a value, so the card says whose word it is. */
const claimOf = (change: GistChange, effect: ChangeEffect) =>
  effect.effect === "list_added" || (toolSaysOnlyAdds(change) && effect.list)
    ? listAddsClaim()
    : undefined;

const ValuesPart = ({ change }: { change: GistChange }) => {
  const { firstRows } = changeLayout(change);
  return firstRows.length === 0 ? null : (
    <div className="space-y-1" data-testid="tool-call-change-values">
      {firstRows.map((effect, index) => (
        <ValueRow key={index} effect={effect} claim={claimOf(change, effect)} />
      ))}
    </div>
  );
};

/**
 * The values past the first view, behind one line that says what they hold
 * and names them. Opened, they scroll in a box of their own.
 */
const SeeMorePart = ({
  change,
  action,
  bounded = false,
}: {
  change: GistChange;
  action: GistAction | undefined;
  /** On a card, past its scroll box, where the opened values need one. */
  bounded?: boolean;
}) => {
  const layout = changeLayout(change);
  const collapsedTotal = layout.collapsed.length + layout.beyondCap;
  if (collapsedTotal === 0) return null;
  const { shown, more } = collapsedNames(
    layout.collapsed.map(effectDisplayName),
  );
  const values = (
    <>
      {layout.collapsed.map((effect, index) => (
        <ValueRow
          key={index}
          effect={effect}
          showRawName
          claim={claimOf(change, effect)}
        />
      ))}
      {layout.beyondCap > 0 && (
        <p className={MUTED}>{fieldsInDetails(layout.beyondCap)}</p>
      )}
    </>
  );
  return (
    <SeeMore
      label={seeMoreWithNames(
        changeSeeMoreLine(change, layout, action),
        shown.join(", "),
        more,
      )}
      defaultOpen={layout.opensByDefault}
    >
      {bounded ? (
        <ScrollBox kind="card" className="max-h-[40vh] min-w-0 space-y-1">
          {values}
        </ScrollBox>
      ) : (
        values
      )}
    </SeeMore>
  );
};

/**
 * The card's one footnote: where underlined and old values come from, and
 * the notes no row or statement carries, with any `extra` lines.
 */
const ChangeFootnote = ({
  notes,
  earlier,
  extra = [],
}: {
  notes: readonly ToolCallChangeNote[];
  /** Whether the card underlines a value as one from an earlier result. */
  earlier: boolean;
  extra?: ReactNode[];
}) => {
  const legend = earlierValuesFootnote(
    earlier,
    notes.includes(OLD_VALUES_NOTE),
  );
  const lines = notes
    .filter((note) => note !== OLD_VALUES_NOTE)
    .map(changeNoteLabel)
    .filter((text) => text.length > 0);
  return legend === undefined &&
    lines.length === 0 &&
    extra.length === 0 ? null : (
    <div className="space-y-0.5" data-testid="tool-call-change-notes">
      {legend !== undefined && <p className={MUTED}>{legend}</p>}
      {lines.map((text, index) => (
        <p key={index} className={MUTED}>
          {text}
        </p>
      ))}
      {extra.length > 0 && (
        <div className={clsx(MUTED, "space-y-0.5")}>{extra}</div>
      )}
    </div>
  );
};

/**
 * The one footnote of a card that lists a change's values in its own
 * argument view: the body's notes and the caller's `extra` lines, after the
 * arguments they are about.
 */
export const ToolCallChangeFootnote = ({
  change,
  extra = [],
}: {
  change: GistChange;
  extra?: ReactNode[];
}) => {
  const places = notePlacesOf(change);
  return (
    <ChangeFootnote
      notes={[...places.qualifier, ...places.lists, ...places.footnote]}
      earlier={false}
      extra={extra}
    />
  );
};

/** A value's new state for a trace row, whose title already says it changed. */
const RowNewValue = ({ effect }: { effect: ChangeEffect }) => {
  const value = effect.values.map(plainChangeValue).join(", ");
  return (
    <>
      {effectName(effect)}
      {effect.old && effect.effect !== "unchanged" ? (
        <>
          {" → "}
          <span
            dir="auto"
            data-testid="tool-call-change-new"
            className={clsx(NEW_VALUE_CLASS, ISOLATED)}
          >
            {value}
          </span>
        </>
      ) : (
        <>
          {" "}
          <NewName effect={effect} />
          {value}
        </>
      )}
    </>
  );
};

/**
 * Under a trace row, what the call did in one line: counts live in the row's
 * title, so this names the losses and who it reached first, then the first
 * values as they are now.
 */
export const ToolCallChangeRowDetails = ({
  change,
}: {
  change: GistChange;
}) => {
  const layout = changeLayout(change);
  const shown = layout.firstRows.slice(0, ROW_VALUES);
  const more = layout.firstRows.length - shown.length + layout.collapsed.length;
  const replaceUnknown = listReplaceIsUnknown(change);
  const parts: ReactNode[] = [];
  if (change.recipients) {
    parts.push(recipientsLine(change.recipients));
    if (
      change.recipients.outsideKnown &&
      change.recipients.outside.length > 0
    ) {
      parts.push(outsideLine(change.recipients));
    }
  }
  if (change.batch && change.batch.deletions > 0) {
    parts.push(batchDeletionsLine(change.batch.deletions, []));
  }
  if (
    change.batch &&
    (change.batch.rowsEmptying > 0 ||
      change.batch.rowsReplacingLists > 0 ||
      change.batch.rowsRemovingFromLists > 0)
  ) {
    parts.push(
      ...batchLossLines(change.batch, replaceUnknown, toolSaysOnlyAdds(change)),
    );
  }
  if (layout.emptied.length > 0) {
    parts.push(
      `${emptiedLabel()}: ${layout.emptied.map(emptiedText).join(", ")}`,
    );
  }
  for (const effect of layout.lists) {
    parts.push(
      effect.removed.length > 0
        ? `${
            replaceUnknown
              ? listWouldGoLabel(effect.name)
              : listRemovedLabel(effect.name)
          }: ${effect.removed.map(plainChangeValue).join(", ")}`
        : `${replaceUnknown ? effect.name : listSetLabel(effect.name)}: ${effect.values
            .map(plainChangeValue)
            .join(", ")}`,
    );
  }
  for (const effect of layout.removedFromLists) {
    parts.push(
      `${listRemovedLabel(effect.name)}: ${effect.values
        .map(plainChangeValue)
        .join(", ")}`,
    );
  }
  if (layout.unreadable.length > 0) {
    parts.push(
      `${unreadableLabel()}: ${layout.unreadable
        .map((effect) => effect.name)
        .join(", ")}`,
    );
  }
  if (change.texts.length > 0) {
    parts.push(
      change.texts
        .map((entry) =>
          textHeading(entry.name, entry.lines, entry.chars, false),
        )
        .join(", "),
    );
  }
  for (const opaque of change.opaque) {
    if (opaque.found.length > 0) {
      parts.push(foundLine(opaque.kind, opaque.found));
    }
  }
  shown.forEach((effect, index) =>
    parts.push(<RowNewValue key={`value-${index}`} effect={effect} />),
  );
  return (
    <p
      dir="auto"
      className={clsx(
        "break-words text-xs text-theme-fg-secondary [overflow-wrap:anywhere]",
        ISOLATED,
      )}
      data-testid="tool-call-change-row-details"
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          {part}
        </Fragment>
      ))}
      {more > 0 && <span className="text-theme-fg-muted"> +{more}</span>}
    </p>
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
    (change.batch?.rowsRemovingFromLists ?? 0) > 0 ||
    layout.emptied.length > 0 ||
    layout.firstRows.length > 0 ||
    layout.lists.length > 0 ||
    layout.removedFromLists.length > 0 ||
    layout.unreadable.length > 0 ||
    change.texts.length > 0 ||
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
 * What a change description says beyond a card's line, one group after the
 * other: who it reaches, what is lost and what cannot be read first, then
 * statements, the values and long text last. A call with no verb lists its
 * values in its own argument view, so `values` leaves them out there.
 */
export const ToolCallChangeBody = ({
  change,
  action,
  replacesText = false,
  values = true,
  outside = true,
  summary,
  operationsInHeadline = false,
}: {
  change: GistChange;
  action?: GistAction;
  replacesText?: boolean;
  values?: boolean;
  /** The card's headline says a batch's operations already. */
  operationsInHeadline?: boolean;
  /**
   * Whether See more and the notes are part of the body; a card puts them
   * after its scroll box instead, so they never scroll out of sight.
   */
  outside?: boolean;
  /** The count line, heading the values where it says what they do not. */
  summary?: string;
}) => {
  const places = notePlacesOf(change);
  return (
    <div className="space-y-3" data-testid="tool-call-change-body">
      <IncompleteAlert change={change} />
      {change.recipients && (
        <RecipientsPart recipients={change.recipients} action={action} />
      )}
      {change.filter && <FilterPart filter={change.filter} />}
      {change.flags.length > 0 && <FlagsPart flags={change.flags} />}
      {summary !== undefined && (
        <p
          className="text-sm font-semibold text-theme-fg-primary"
          data-testid="tool-call-change-summary"
        >
          {summary}
        </p>
      )}
      {values && <LossesPart change={change} />}
      {change.opaque.map((opaque, index) => (
        <OpaquePart key={index} opaque={opaque} notes={places.statement} />
      ))}
      {change.batch && (
        <BatchPart
          batch={change.batch}
          listsMaybeReplaced={listReplaceIsUnknown(change)}
          onlyAdds={toolSaysOnlyAdds(change)}
          operationsInHeadline={operationsInHeadline}
        />
      )}
      {values && <ValuesPart change={change} />}
      {change.texts.map((entry, index) => (
        <TextPart key={index} entry={entry} replaced={replacesText} />
      ))}
      {values && outside && <SeeMorePart change={change} action={action} />}
      {outside && (
        <ChangeFootnote
          notes={[
            ...places.qualifier,
            ...(values ? [] : places.lists),
            ...places.footnote,
          ]}
          earlier={false}
        />
      )}
    </div>
  );
};

/** What a delete does and that nothing changes: under the headline. */
const QualifierNotes = ({
  notes,
}: {
  notes: readonly ToolCallChangeNote[];
}) => (
  <>
    {notes.map((note) =>
      note === "tool_says_permanent" ? (
        <Alert
          key={note}
          type="warning"
          role="none"
          data-testid="tool-call-change-qualifier"
        >
          {changeNoteLabel(note)}
        </Alert>
      ) : (
        <p
          key={note}
          className="text-sm text-theme-fg-secondary"
          data-testid="tool-call-change-qualifier"
        >
          {changeNoteLabel(note)}
        </p>
      ),
    )}
  </>
);

/**
 * What an approval card shows for a call with a change description, in the
 * order every card uses: the headline with what qualifies it, the risks the
 * call itself carries, then in one bounded box who it reaches, what is lost
 * and the values, at most five unless only one or two more would be hidden;
 * the rest behind one line that names them, and one footnote. Facts about the
 * tool rather than the call are the decision area's.
 */
export const ToolCallChangeCard = ({
  gist,
  change,
  phase,
  notes,
  footnotes,
  toolTitle,
  placeInSource = false,
  belowHeading = false,
}: {
  gist: Gist;
  change: GistChange;
  phase: GistPhase;
  /** The caller's source line names the item's place, so the headline does not. */
  placeInSource?: boolean;
  /** Under a heading of the caller's own, so the headline is no larger than a row. */
  belowHeading?: boolean;
  /** What the card warns about beyond the call's values, under the headline. */
  notes?: ReactNode;
  /** Lines the caller adds to the card's footnote. */
  footnotes?: ReactNode[];
  /** The tool's own title or name, said where the line can only say "item". */
  toolTitle?: string;
}) => {
  const layout = changeLayout(change);
  const summary = changeSummaryLine(change, layout, gist.action);
  const places = notePlacesOf(change);
  const showsToolTitle =
    toolTitle !== undefined && toolTitle.length > 0 && namesOnlyAnItem(gist);
  // Operations code counted say more than a verb a mapping picked: a batch
  // that deletes two rows is no "Update". A headline that still names where
  // the call goes keeps it.
  const lead = gist.items.at(0);
  const operationsHead =
    change.batch &&
    change.batch.operations.length > 1 &&
    lead !== undefined &&
    headlineItemOf(gist, lead, placeInSource).where.length === 0
      ? batchOperationsLine(change.batch)
      : undefined;
  return (
    <div className="space-y-3" data-testid="tool-call-gist">
      <div className="space-y-1" data-testid="tool-call-change-head">
        {gist.items.map((item, index) => (
          <Fragment key={index}>
            <ScrollBox
              kind="line"
              as="p"
              className={clsx(
                "max-h-32 break-words text-theme-fg-primary [overflow-wrap:anywhere]",
                headlineClass(index === 0, belowHeading),
              )}
              data-testid="tool-call-gist-line"
            >
              {index === 0 && operationsHead !== undefined ? (
                operationsHead
              ) : (
                <ToolCallGistLine
                  gist={gist}
                  item={headlineItemOf(gist, item, placeInSource)}
                  phase={phase}
                  variant="card"
                />
              )}
            </ScrollBox>
            {showsUnreadRecord(gist, item) && (
              <p
                className="text-sm text-theme-fg-secondary"
                data-testid="tool-call-gist-unread"
              >
                {gistUnreadRecordLine(gist)}
              </p>
            )}
          </Fragment>
        ))}
        {showsToolTitle && (
          <p
            className="break-words text-sm text-theme-fg-secondary [overflow-wrap:anywhere]"
            data-testid="tool-call-change-tool-title"
          >
            {toolTitleLabel()}{" "}
            <q dir="auto" className={ISOLATED}>
              {toolTitle}
            </q>
          </p>
        )}
        <QualifierNotes notes={places.qualifier} />
      </div>
      {gist.warnings.map((warning) => (
        <Alert key={warning} type="warning" role="none">
          {gistWarningLabel(warning)}
        </Alert>
      ))}
      {notes}
      <ScrollBox
        kind="card"
        className="max-h-[50vh] min-w-0"
        data-testid="tool-call-gist-scroll"
      >
        <ToolCallChangeBody
          change={change}
          action={gist.action}
          replacesText={gist.action === "update" || gist.action === "upsert"}
          outside={false}
          summary={summary}
          operationsInHeadline={operationsHead !== undefined}
        />
      </ScrollBox>
      <SeeMorePart change={change} action={gist.action} bounded />
      <ChangeFootnote
        notes={places.footnote}
        earlier={showsEarlierValues(gist)}
        extra={footnotes}
      />
    </div>
  );
};
