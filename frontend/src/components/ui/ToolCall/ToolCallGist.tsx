import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";
import { Fragment } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import { gistItemLayout, listedValues, shortId } from "@/lib/toolCallGist/gist";
import {
  GIST_SLOTS,
  GIST_TITLE_SLOT,
  GIST_WHERE_SLOT,
  gistLineSentence,
  gistWarningLabel,
} from "@/lib/toolCallGist/gistLabels";
import { SCROLL_BOX_CLASS, scrollBoxProps } from "@/lib/toolCallGist/scrollBox";

import type {
  Gist,
  GistBatchRow,
  GistField,
  GistItem,
  GistPhase,
  GistValue,
} from "@/lib/toolCallGist/gist";
import type { ReactNode } from "react";

const ISOLATED = "[unicode-bidi:isolate]";

const cutText = (text: string, truncated: boolean) =>
  truncated ? `${text}…` : text;

/** What the call writes where a name stands for it; an ID short unless `wholeId`. */
const WrittenBeside = ({
  value,
  wholeId,
}: {
  value: GistValue;
  wholeId: boolean;
}) => {
  if (value.written === undefined) return null;
  const short = value.writtenId === true && !wholeId;
  const written = short
    ? shortId(value.written)
    : cutText(value.written, value.truncated);
  return (
    <span className="text-theme-fg-muted" data-testid="tool-call-gist-written">
      {" "}
      <span className="sr-only">
        {t({ id: "toolGist.value.writtenAs", message: "written as" })}{" "}
      </span>
      <span aria-hidden="true">&lt;</span>
      <span
        dir="auto"
        title={short ? value.written : undefined}
        className={clsx(value.writtenId && "font-mono text-[0.9em]", ISOLATED)}
      >
        {written}
      </span>
      <span aria-hidden="true">&gt;</span>
    </span>
  );
};

/**
 * One value as inert, direction-isolated text that shows where it came from:
 * quoted as the call wrote it, underlined when an earlier result named or
 * held it, monospace when it is an ID. With `showWritten`, as on an approval
 * card, a name has the value the call writes beside it, so a name from an
 * earlier result never stands in for it. With `wholeId`, also on an approval
 * card, an ID shows whole: two IDs that start alike never look the same.
 */
export const GistValueText = ({
  value,
  showWritten = false,
  wholeId = false,
}: {
  value: GistValue;
  showWritten?: boolean;
  wholeId?: boolean;
}) => {
  const text =
    value.truncated && value.origin !== "resolved"
      ? `${value.text}…`
      : value.text;
  switch (value.origin) {
    case "written":
      return (
        <q dir="auto" data-origin="written" className={ISOLATED}>
          {text}
        </q>
      );
    case "resolved":
    case "earlier":
      return (
        <>
          <span
            dir="auto"
            data-origin={value.origin}
            title={
              value.origin === "resolved"
                ? t({
                    id: "toolGist.value.resolved",
                    message: "Name from an earlier result in this chat",
                  })
                : t({
                    id: "toolGist.value.earlier",
                    message: "Value from an earlier result in this chat",
                  })
            }
            className={clsx(
              "underline decoration-dotted underline-offset-2",
              ISOLATED,
            )}
          >
            {text}
          </span>
          {showWritten && value.origin === "resolved" && (
            <WrittenBeside value={value} wholeId={wholeId} />
          )}
        </>
      );
    case "id": {
      const whole = wholeId ? value.written : undefined;
      return (
        <span
          dir="auto"
          data-origin="id"
          title={whole === undefined ? value.written : undefined}
          className={clsx("font-mono text-[0.9em]", ISOLATED)}
        >
          {whole === undefined ? text : cutText(whole, value.truncated)}
        </span>
      );
    }
  }
};

const moreLabel = (more: number) =>
  t({
    id: "toolGist.more",
    message: plural(more, { one: "+# more", other: "+# more" }),
  });

const GistValueList = ({
  values,
  omitted = 0,
  showWritten,
  wholeId,
}: {
  values: GistValue[];
  omitted?: number;
  showWritten: boolean;
  wholeId: boolean;
}) => {
  const shown = listedValues(values);
  const more = values.length - shown.length + omitted;
  return (
    <>
      {shown.map((value, index) => (
        <Fragment key={index}>
          {index > 0 && ", "}
          <GistValueText
            value={value}
            showWritten={showWritten}
            wholeId={wholeId}
          />
        </Fragment>
      ))}
      {more > 0 && (
        <span className="text-theme-fg-muted"> {moreLabel(more)}</span>
      )}
    </>
  );
};

/**
 * What one item does to what, and where, as one sentence. Before approval a
 * name has the value the call writes beside it; on a card IDs show whole.
 */
export const ToolCallGistLine = ({
  gist,
  item,
  phase,
  variant = "row",
}: {
  gist: Gist;
  item: GistItem;
  phase: GistPhase;
  variant?: "card" | "row";
}) => (
  <>
    {gistLineSentence(gist, item, phase)
      .split(GIST_SLOTS)
      .map((part, index) =>
        part === GIST_TITLE_SLOT ? (
          <GistValueList
            key={index}
            values={item.names}
            showWritten={phase === "ask"}
            wholeId={variant === "card"}
          />
        ) : part === GIST_WHERE_SLOT ? (
          <GistValueList
            key={index}
            values={item.where}
            omitted={item.whereOmitted}
            showWritten={phase === "ask"}
            wholeId={variant === "card"}
          />
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
  </>
);

const FieldValues = ({
  values,
  omitted = 0,
  wholeId,
}: {
  values: GistField["values"];
  omitted?: number;
  wholeId: boolean;
}) => {
  const shown = listedValues(values);
  const more = values.length - shown.length + omitted;
  return (
    <>
      {shown.map(({ value, earlier }, index) => (
        <Fragment key={index}>
          {index > 0 && ", "}
          {earlier && (
            <>
              <span data-testid="tool-call-gist-earlier">
                <GistValueText value={earlier} />
              </span>
              <span aria-hidden="true" className="px-1 text-theme-fg-muted">
                →
              </span>
              <span className="sr-only">
                {t({ id: "toolGist.changesTo", message: "changes to" })}
              </span>
            </>
          )}
          <GistValueText value={value} wholeId={wholeId} />
        </Fragment>
      ))}
      {more > 0 && (
        <span className="text-theme-fg-muted"> {moreLabel(more)}</span>
      )}
    </>
  );
};

const FieldList = ({
  fields,
  wholeId,
}: {
  fields: GistField[];
  wholeId: boolean;
}) =>
  fields.length === 0 ? null : (
    <dl className="grid grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
      {fields.map((field, index) => (
        <Fragment key={index}>
          <dt
            dir="auto"
            className={clsx("break-words text-theme-fg-muted", ISOLATED)}
          >
            {field.name}
          </dt>
          <dd className="min-w-0">
            <div
              {...scrollBoxProps("value")}
              className={clsx(
                SCROLL_BOX_CLASS,
                "max-h-24 break-words text-theme-fg-primary [overflow-wrap:anywhere]",
              )}
            >
              <FieldValues
                values={field.values}
                omitted={field.omitted}
                wholeId={wholeId}
              />
            </div>
          </dd>
        </Fragment>
      ))}
    </dl>
  );

/** A batch's things, one per row, each with the fields read at its position. */
const BatchRows = ({
  item,
  rows,
  onCard,
}: {
  item: GistItem;
  rows: GistBatchRow[];
  onCard: boolean;
}) => (
  <ul className="space-y-1 text-xs" data-testid="tool-call-gist-rows">
    {rows.map(({ name, fields }, index) => (
      <li key={index} className="min-w-0 break-words [overflow-wrap:anywhere]">
        <div
          {...scrollBoxProps("value")}
          className={clsx(
            SCROLL_BOX_CLASS,
            "max-h-24 text-sm text-theme-fg-primary",
          )}
        >
          <GistValueText value={name} showWritten={onCard} wholeId={onCard} />
        </div>
        {fields.length > 0 && (
          <div className="mt-0.5 pl-3">
            <FieldList fields={fields} wholeId={onCard} />
          </div>
        )}
      </li>
    ))}
    {item.count > item.names.length && (
      <li className="text-theme-fg-muted">
        {moreLabel(item.count - item.names.length)}
      </li>
    )}
  </ul>
);

const TextBlock = ({
  values,
  className,
}: {
  values: GistValue[];
  className?: string;
}) => (
  <>
    {values.map((value, index) => (
      <p
        key={index}
        dir="auto"
        {...scrollBoxProps("value")}
        className={clsx(
          SCROLL_BOX_CLASS,
          "max-h-32 whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]",
          ISOLATED,
          className,
        )}
      >
        {value.origin === "written" ? (
          cutText(value.text, value.truncated)
        ) : (
          <GistValueText value={value} showWritten wholeId />
        )}
      </p>
    ))}
  </>
);

const TextChange = ({ item }: { item: GistItem }) => {
  if (item.before.length === 0 && item.after.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="tool-call-gist-text">
      <p className="text-xs text-theme-fg-muted">
        {item.before.length > 0
          ? t({ id: "toolGist.textChange", message: "Text change" })
          : t({ id: "toolGist.content", message: "Content" })}
      </p>
      {item.before.length > 0 && (
        <TextBlock
          values={item.before}
          className="text-theme-fg-muted line-through"
        />
      )}
      <TextBlock values={item.after} className="text-theme-fg-primary" />
    </div>
  );
};

const textChangeCount = (item: GistItem) =>
  item.before.length > 0 ? Math.max(item.before.length, item.after.length) : 0;

/**
 * The values under an item's line: its key values with old → new where an
 * earlier result had the old one, a batch row by row, and on a card the text
 * it writes and the values names stand for. A trace row counts text changes
 * instead of repeating them.
 */
export const ToolCallGistValues = ({
  item,
  variant,
}: {
  item: GistItem;
  variant: "card" | "row";
}) => {
  const { rows, shared } = gistItemLayout(item);
  const changes = textChangeCount(item);
  const onCard = variant === "card";
  return (
    <div className="space-y-2" data-testid="tool-call-gist-values">
      {rows && <BatchRows item={item} rows={rows} onCard={onCard} />}
      <FieldList fields={shared} wholeId={onCard} />
      {onCard ? (
        <TextChange item={item} />
      ) : (
        changes > 0 && (
          <p className="text-xs text-theme-fg-muted">
            {t({
              id: "toolGist.textChanges",
              message: plural(changes, {
                one: "# text change",
                other: "# text changes",
              }),
            })}
          </p>
        )
      )}
    </div>
  );
};

/**
 * The gist a card shows before approval: the warnings its values call for
 * and the card's `notes` first, then each item's line and values and what
 * else the card lists (`children`) in one bounded box. Values show whole, so
 * a long line, field value or row also scrolls in a box of its own; however
 * long a batch, what the card warns about stays on top and the buttons below
 * stay close.
 */
export const ToolCallGist = ({
  gist,
  phase,
  notes,
  children,
}: {
  gist: Gist;
  phase: GistPhase;
  notes?: ReactNode;
  children?: ReactNode;
}) => (
  <div className="space-y-2" data-testid="tool-call-gist">
    {gist.warnings.map((warning) => (
      <Alert key={warning} type="warning" role="none">
        {gistWarningLabel(warning)}
      </Alert>
    ))}
    {notes}
    <div
      {...scrollBoxProps("card")}
      className={clsx(SCROLL_BOX_CLASS, "max-h-[50vh] min-w-0 space-y-2")}
      data-testid="tool-call-gist-scroll"
    >
      {gist.items.map((item, index) => (
        <div key={index} className="space-y-1">
          <p
            {...scrollBoxProps("line")}
            className={clsx(
              SCROLL_BOX_CLASS,
              "max-h-32 break-words text-sm font-medium text-theme-fg-primary [overflow-wrap:anywhere]",
            )}
            data-testid="tool-call-gist-line"
          >
            <ToolCallGistLine
              gist={gist}
              item={item}
              phase={phase}
              variant="card"
            />
          </p>
          <ToolCallGistValues item={item} variant="card" />
        </div>
      ))}
      {children}
    </div>
  </div>
);
