import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";

import { isConsentClaim } from "@/lib/toolCallGist/consent";
import { shortId } from "@/lib/toolCallGist/gist";
import {
  cleanServerText,
  jsonPreview,
  lastPointerSegment,
  MAX_SERVER_DESCRIPTION_CHARS,
  MAX_SERVER_TEXT_CHARS,
  readPointer,
} from "@/lib/toolCallGist/serverText";

import type { ToolArgumentNode } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const ISOLATED = "[unicode-bidi:isolate]";

const scalarText = (value: unknown, maxChars: number): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return jsonPreview(value, maxChars);
};

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

const Scalar = ({
  node,
  value,
  compact,
}: {
  node: ToolArgumentNode;
  value: unknown;
  compact: boolean;
}) => {
  const maxChars =
    node.kind === "text" && !compact
      ? MAX_SERVER_DESCRIPTION_CHARS
      : MAX_SERVER_TEXT_CHARS;
  const { text, truncated } = cleanServerText(
    scalarText(value, maxChars),
    maxChars,
  );
  const shown = truncated ? `${text}…` : text;
  switch (node.kind) {
    case "id":
      return (
        <span
          dir="auto"
          title={shown}
          className={clsx("font-mono text-xs", ISOLATED)}
        >
          {shortId(shown)}
        </span>
      );
    case "text":
      return (
        <p
          dir="auto"
          className={clsx(
            "max-h-32 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
            ISOLATED,
          )}
        >
          {shown}
        </p>
      );
    default:
      return (
        <span dir="auto" className={clsx("break-words", ISOLATED)}>
          {shown}
        </span>
      );
  }
};

interface NodeProps {
  node: ToolArgumentNode;
  input: unknown;
  compact: boolean;
}

const Members = ({ node, input, compact }: NodeProps) => {
  const members = childrenOf(node).flatMap((child) => {
    const value = readPointer(input, child.path);
    const name = cleanServerText(lastPointerSegment(child.path)).text;
    return isConsentClaim(value, child.path) ? [] : [{ child, name }];
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
            <ArgumentNode node={child} input={input} compact={compact} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

const ArgumentNode = ({ node, input, compact }: NodeProps) => {
  const omitted = omittedOf(node);
  switch (node.kind) {
    case "group":
      return (
        <div className="space-y-1">
          <Members node={node} input={input} compact={compact} />
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
              <ArgumentNode node={child} input={input} compact={compact} />
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
      return (
        <Scalar
          node={node}
          value={readPointer(input, node.path)}
          compact={compact}
        />
      );
  }
};

/**
 * A call's arguments as names and values, from the readable view the backend
 * sends with the label. The view holds paths only; names and values are read
 * from `input` and shown as inert text, because the call wrote them.
 * `compact` keeps long text to a short value, for a list beside a summary.
 */
export const ToolArgumentView = ({
  view,
  input,
  compact = false,
  className,
  "data-testid": dataTestId = "tool-argument-view",
}: {
  view: ToolArgumentNode;
  input: unknown;
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
        <ArgumentNode node={view} input={input} compact={compact} />
      )}
    </div>
  );
};
