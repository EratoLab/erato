import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { Disclosure } from "@/components/ui/Controls/Disclosure";
import { Alert } from "@/components/ui/Feedback/Alert";
import {
  McpToolDescription,
  ToolArgumentView,
  ToolCallGist,
  ToolCallInput,
} from "@/components/ui/ToolCall";
import { gistOf } from "@/lib/toolCallGist/gist";

import { ComputerIcon, ResolvedIcon } from "../icons";
import { ApprovalToolHeading } from "./ApprovalToolHeading";

import type { ToolDisplayMetadata } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ApprovalReferentProps {
  toolName: string;
  display?: ToolDisplayMetadata | null;
  input: unknown;
  /** The MCP server, or a client tool's namespace. */
  serverId: string;
  isClientTool: boolean;
  titleClassName?: string;
  className?: string;
}

const referentIcon = (isClientTool: boolean) =>
  isClientTool ? (
    <ComputerIcon className="size-4 shrink-0 text-theme-fg-secondary" />
  ) : (
    <ResolvedIcon
      iconId="simpleicons-modelcontextprotocol"
      className="size-4 shrink-0 text-theme-fg-secondary"
    />
  );

const referentSource = (
  display: ToolDisplayMetadata | null | undefined,
  serverId: string,
  isClientTool: boolean,
) =>
  isClientTool
    ? t({ id: "clientToolApproval.thisDevice", message: "This device" })
    : (display?.server_name ?? serverId);

/**
 * What an approval asks about, above its consent card. A call with a label
 * reads as its gist: one line on what it does to what, and where, with its
 * key values. A label without a gist shows the arguments as names and values.
 * Requests saved before labels keep the tool heading and the raw input.
 */
export const ApprovalReferent = ({
  toolName,
  display,
  input,
  serverId,
  isClientTool,
  titleClassName,
  className,
}: ApprovalReferentProps) => {
  const label = display?.label;
  const gist = gistOf(label);
  const icon = referentIcon(isClientTool);
  const source = referentSource(display, serverId, isClientTool);

  if (gist) {
    return (
      <div className={clsx("space-y-2", className)}>
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span
            dir="auto"
            className="min-w-0 break-words text-xs text-theme-fg-muted [unicode-bidi:isolate]"
          >
            {source}
          </span>
        </div>
        <ToolCallGist gist={gist} phase="ask" />
      </div>
    );
  }

  const heading = (
    <ApprovalToolHeading
      className={className}
      toolName={toolName}
      display={display}
      icon={icon}
      source={source}
      titleClassName={titleClassName}
    />
  );
  if (label?.arguments) {
    return (
      <>
        {heading}
        <div className="mt-2 max-h-48 overflow-y-auto">
          <ToolArgumentView view={label.arguments} input={input} />
        </div>
        {/* eslint-disable-next-line lingui/no-unlocalized-strings -- API warning value */}
        {label.warnings?.includes("arguments_truncated") && (
          <Alert type="info" role="none" className="mt-2">
            {t({
              id: "toolArguments.truncated",
              message:
                "Some arguments are not shown here. Technical details has all of them.",
            })}
          </Alert>
        )}
      </>
    );
  }
  return (
    <>
      {heading}
      <div className="mt-2 max-h-48 overflow-y-auto">
        <ToolCallInput input={input} />
      </div>
    </>
  );
};

/**
 * The tool, its server and the raw arguments of a labelled call, one click
 * away below the consent card. Requests saved before labels show their raw
 * input already, so they get none.
 */
export const ApprovalTechnicalDetails = ({
  toolName,
  display,
  input,
  serverId,
  isClientTool,
}: Omit<ApprovalReferentProps, "titleClassName" | "className">) => {
  if (!display?.label) return null;
  const isGist = gistOf(display.label) !== undefined;
  return (
    <Disclosure
      className="mt-1"
      bodyClassName="space-y-2 pt-1"
      label={t({
        id: "toolCall.technicalDetails",
        message: "Technical details",
      })}
      data-testid="approval-technical-details"
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-theme-fg-muted">
          {t({ id: "toolCall.technicalDetails.tool", message: "Tool" })}
        </dt>
        <dd
          dir="auto"
          className="break-words font-mono text-theme-fg-primary [unicode-bidi:isolate]"
        >
          {toolName}
        </dd>
        <dt className="text-theme-fg-muted">
          {t({ id: "toolCall.technicalDetails.server", message: "Server" })}
        </dt>
        <dd
          dir="auto"
          className="break-words font-mono text-theme-fg-primary [unicode-bidi:isolate]"
        >
          {isClientTool ? referentSource(display, serverId, true) : serverId}
        </dd>
      </dl>
      {/* The generic card shows the descriptor in its heading already. */}
      {isGist && display.title !== toolName && (
        <p
          dir="auto"
          className="text-xs text-theme-fg-secondary [unicode-bidi:isolate]"
        >
          {display.title}
        </p>
      )}
      {isGist && display.description && (
        <McpToolDescription
          description={display.description}
          truncated={display.description_truncated}
        />
      )}
      <ToolCallInput input={input} />
    </Disclosure>
  );
};
