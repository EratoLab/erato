import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";

import { shortId } from "@/lib/toolCallGist/gist";
import {
  cleanServerText,
  lastPointerSegment,
  MAX_SERVER_DESCRIPTION_CHARS,
  MAX_SERVER_TEXT_CHARS,
  readPointer,
} from "@/lib/toolCallGist/serverText";

import type { ToolArgumentNode } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const ISOLATED = "[unicode-bidi:isolate]";

/**
 * Says what the model claims about the user, never what the call does; the
 * backend's rules leave the same members out of a label's fields.
 */
const isConsentClaim = (name: string, value: unknown): boolean => {
  const lower = name.toLowerCase();
  return (
    typeof value === "boolean" &&
    lower.includes("user") &&
    (lower.includes("approv") || lower.includes("confirm"))
  );
};

const scalarText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return value === undefined ? "" : JSON.stringify(value);
};

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
}: {
  node: ToolArgumentNode;
  value: unknown;
}) => {
  const { text, truncated } = cleanServerText(
    scalarText(value),
    node.kind === "text" ? MAX_SERVER_DESCRIPTION_CHARS : MAX_SERVER_TEXT_CHARS,
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

const Members = ({
  node,
  input,
}: {
  node: ToolArgumentNode;
  input: unknown;
}) => {
  const members = (node.children ?? []).flatMap((child) => {
    const value = readPointer(input, child.path);
    const name = cleanServerText(lastPointerSegment(child.path) ?? "").text;
    return isConsentClaim(name, value) ? [] : [{ child, name }];
  });
  return (
    <dl className="grid grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {members.map(({ child, name }) => (
        <div key={child.path} className="contents">
          <dt
            dir="auto"
            className={clsx("break-words text-theme-fg-muted", ISOLATED)}
          >
            {name}
          </dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            <ArgumentNode node={child} input={input} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

const ArgumentNode = ({
  node,
  input,
}: {
  node: ToolArgumentNode;
  input: unknown;
}) => {
  const omitted = node.omitted ?? 0;
  switch (node.kind) {
    case "group":
      return (
        <div className="space-y-1">
          <Members node={node} input={input} />
          {omitted > 0 && (
            <p className="text-theme-fg-muted">{omittedLabel(omitted)}</p>
          )}
        </div>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-4">
          {(node.children ?? []).map((child) => (
            <li key={child.path} className="min-w-0">
              <ArgumentNode node={child} input={input} />
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
      return <Scalar node={node} value={readPointer(input, node.path)} />;
  }
};

/**
 * A call's arguments as names and values, from the readable view the backend
 * sends with the label. The view holds paths only; names and values are read
 * from `input` and shown as inert text, because the call wrote them.
 */
export const ToolArgumentView = ({
  view,
  input,
  className,
}: {
  view: ToolArgumentNode;
  input: unknown;
  className?: string;
}) => {
  const empty =
    (view.kind === "group" || view.kind === "list") &&
    (view.children ?? []).length === 0 &&
    (view.omitted ?? 0) === 0;
  return (
    <div
      className={clsx("text-xs text-theme-fg-primary", className)}
      data-testid="tool-argument-view"
    >
      {empty ? (
        <p className="text-theme-fg-muted">
          {t({ id: "toolArguments.none", message: "No arguments" })}
        </p>
      ) : (
        <ArgumentNode node={view} input={input} />
      )}
    </div>
  );
};
