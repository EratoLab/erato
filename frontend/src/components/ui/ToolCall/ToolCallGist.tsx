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

import type {
  Gist,
  GistBatchRow,
  GistField,
  GistItem,
  GistPhase,
  GistValue,
} from "@/lib/toolCallGist/gist";

const ISOLATED = "[unicode-bidi:isolate]";

/** What the call writes where a name stands for it: the value, or its ID short. */
const WrittenBeside = ({ value }: { value: GistValue }) => {
  if (value.written === undefined) return null;
  const written = value.writtenId
    ? shortId(value.written)
    : value.truncated
      ? `${value.written}…`
      : value.written;
  return (
    <span className="text-theme-fg-muted" data-testid="tool-call-gist-written">
      {" "}
      <span className="sr-only">
        {t({ id: "toolGist.value.writtenAs", message: "written as" })}{" "}
      </span>
      <span aria-hidden="true">&lt;</span>
      <span
        dir="auto"
        title={value.writtenId ? value.written : undefined}
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
 * earlier result never stands in for it.
 */
export const GistValueText = ({
  value,
  showWritten = false,
}: {
  value: GistValue;
  showWritten?: boolean;
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
            <WrittenBeside value={value} />
          )}
        </>
      );
    case "id":
      return (
        <span
          dir="auto"
          data-origin="id"
          title={value.written}
          className={clsx("font-mono text-[0.9em]", ISOLATED)}
        >
          {text}
        </span>
      );
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
}: {
  values: GistValue[];
  omitted?: number;
  showWritten: boolean;
}) => {
  const shown = listedValues(values);
  const more = values.length - shown.length + omitted;
  return (
    <>
      {shown.map((value, index) => (
        <Fragment key={index}>
          {index > 0 && ", "}
          <GistValueText value={value} showWritten={showWritten} />
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
 * name has the value the call writes beside it.
 */
export const ToolCallGistLine = ({
  gist,
  item,
  phase,
}: {
  gist: Gist;
  item: GistItem;
  phase: GistPhase;
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
          />
        ) : part === GIST_WHERE_SLOT ? (
          <GistValueList
            key={index}
            values={item.where}
            omitted={item.whereOmitted}
            showWritten={phase === "ask"}
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
}: {
  values: GistField["values"];
  omitted?: number;
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
          <GistValueText value={value} />
        </Fragment>
      ))}
      {more > 0 && (
        <span className="text-theme-fg-muted"> {moreLabel(more)}</span>
      )}
    </>
  );
};

const FieldList = ({ fields }: { fields: GistField[] }) =>
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
          <dd className="min-w-0 break-words text-theme-fg-primary [overflow-wrap:anywhere]">
            <FieldValues values={field.values} omitted={field.omitted} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );

/** A batch's things, one per row, each with the fields read at its position. */
const BatchRows = ({
  item,
  rows,
  showWritten,
}: {
  item: GistItem;
  rows: GistBatchRow[];
  showWritten: boolean;
}) => (
  <ul className="space-y-1 text-xs" data-testid="tool-call-gist-rows">
    {rows.map(({ name, fields }, index) => (
      <li key={index} className="min-w-0 break-words [overflow-wrap:anywhere]">
        <span className="text-sm text-theme-fg-primary">
          <GistValueText value={name} showWritten={showWritten} />
        </span>
        {fields.length > 0 && (
          <div className="mt-0.5 pl-3">
            <FieldList fields={fields} />
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
        className={clsx(
          "max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]",
          ISOLATED,
          className,
        )}
      >
        {value.origin === "written" ? (
          value.truncated ? (
            `${value.text}…`
          ) : (
            value.text
          )
        ) : (
          <GistValueText value={value} showWritten />
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
  return (
    <div className="space-y-2" data-testid="tool-call-gist-values">
      {rows && (
        <BatchRows item={item} rows={rows} showWritten={variant === "card"} />
      )}
      <FieldList fields={shared} />
      {variant === "card" ? (
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
 * The gist a card shows before approval: each item's line and values, and
 * the warnings the values the call writes call for.
 */
export const ToolCallGist = ({
  gist,
  phase,
}: {
  gist: Gist;
  phase: GistPhase;
}) => (
  <div className="space-y-2" data-testid="tool-call-gist">
    {gist.items.map((item, index) => (
      <div key={index} className="space-y-1">
        <p
          className="break-words text-sm font-medium text-theme-fg-primary [overflow-wrap:anywhere]"
          data-testid="tool-call-gist-line"
        >
          <ToolCallGistLine gist={gist} item={item} phase={phase} />
        </p>
        <ToolCallGistValues item={item} variant="card" />
      </div>
    ))}
    {gist.warnings.map((warning) => (
      <Alert key={warning} type="warning" role="none">
        {gistWarningLabel(warning)}
      </Alert>
    ))}
  </div>
);
