import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";

import { machineIdPhrase } from "@/lib/toolCallGist/changeLabels";
import { isConsentClaim } from "@/lib/toolCallGist/consent";
import { SCROLL_BOX_CLASS, scrollBoxProps } from "@/lib/toolCallGist/scrollBox";
import {
  cleanServerText,
  lastPointerSegment,
  MAX_SERVER_TEXT_CHARS,
} from "@/lib/toolCallGist/serverText";

import type { ToolArgumentNode } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ArgumentTexts } from "@/lib/toolCallGist/argumentValues";
import type { CleanText } from "@/lib/toolCallGist/serverText";

const ISOLATED = "[unicode-bidi:isolate]";

const childrenOf = (node: ToolArgumentNode): ToolArgumentNode[] =>
  Array.isArray(node.children) ? node.children : [];

const omittedOf = (node: ToolArgumentNode): number =>
  typeof node.omitted === "number" && node.omitted > 0 ? node.omitted : 0;

const omittedLabel = (omitted: number) =>
  t({
    id: "toolArguments.omitted",
    message: plural(omitted, {
      one: "# more not shown",
      other: "# more not shown",
    }),
  });

const NO_TEXT: CleanText = {
  text: "",
  truncated: false,
  hiddenCharacters: false,
};

// Long text gets a box of its own that scrolls, so a value is never cut.
const isLongText = (kind: string, text: string) =>
  kind === "text" || text.includes("\n") || text.length > MAX_SERVER_TEXT_CHARS;

// IDs show whole, so two that start alike never look the same.
const Scalar = ({ node, values, compact }: NodeProps) => {
  if (node.kind === "machine_id") {
    return <span className="text-theme-fg-muted">{machineIdPhrase()}</span>;
  }
  const { text, truncated } = values.get(node.path) ?? NO_TEXT;
  const shown = truncated ? `${text}…` : text;
  const isId = node.kind === "id";
  return isLongText(node.kind, shown) ? (
    <p
      dir="auto"
      {...scrollBoxProps("value")}
      className={clsx(
        SCROLL_BOX_CLASS,
        "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
        compact ? "max-h-24" : "max-h-32",
        isId && "font-mono",
        ISOLATED,
      )}
      data-testid="tool-argument-text"
    >
      {shown}
    </p>
  ) : (
    <span
      dir="auto"
      className={clsx("break-words", isId && "font-mono", ISOLATED)}
    >
      {shown}
    </span>
  );
};

interface NodeProps {
  node: ToolArgumentNode;
  values: ArgumentTexts;
  compact: boolean;
}

const Members = ({ node, values, compact }: NodeProps) => {
  const members = childrenOf(node).flatMap((child) => {
    const name = cleanServerText(lastPointerSegment(child.path)).text;
    return isConsentClaim(child.path) ? [] : [{ child, name }];
  });
  return (
    <dl className="grid grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {members.map(({ child, name }, index) => (
        <div key={index} className="contents">
          <dt
            dir="auto"
            className={clsx("break-words text-theme-fg-muted", ISOLATED)}
          >
            {name}
          </dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            <ArgumentNode node={child} values={values} compact={compact} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

const ArgumentNode = ({ node, values, compact }: NodeProps) => {
  const omitted = omittedOf(node);
  switch (node.kind) {
    case "group":
      return (
        <div className="space-y-1">
          <Members node={node} values={values} compact={compact} />
          {omitted > 0 && (
            <p className="text-theme-fg-muted">{omittedLabel(omitted)}</p>
          )}
        </div>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-4">
          {childrenOf(node).map((child, index) => (
            <li key={index} className="min-w-0">
              <ArgumentNode node={child} values={values} compact={compact} />
            </li>
          ))}
          {omitted > 0 && (
            <li className="list-none text-theme-fg-muted">
              {omittedLabel(omitted)}
            </li>
          )}
        </ul>
      );
    default:
      return <Scalar node={node} values={values} compact={compact} />;
  }
};

/**
 * A call's arguments as names and values, from the readable view the backend
 * sends with the label. The view holds paths only; names come from the paths
 * and values are the call's input as `readArgumentValues` read it, whole,
 * shown as inert text, because the call wrote them. `compact` gives long text
 * a shorter box, for a list beside a summary.
 */
export const ToolArgumentView = ({
  view,
  values,
  compact = false,
  className,
  "data-testid": dataTestId = "tool-argument-view",
}: {
  view: ToolArgumentNode;
  values: ArgumentTexts;
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}) => {
  const empty =
    (view.kind === "group" || view.kind === "list") &&
    childrenOf(view).length === 0 &&
    omittedOf(view) === 0;
  return (
    <div
      className={clsx("text-xs text-theme-fg-primary", className)}
      data-testid={dataTestId}
    >
      {empty ? (
        <p className="text-theme-fg-muted">
          {t({ id: "toolArguments.none", message: "No arguments" })}
        </p>
      ) : (
        <ArgumentNode node={view} values={values} compact={compact} />
      )}
    </div>
  );
};
