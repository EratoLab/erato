import { t } from "@lingui/core/macro";
import { useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";

import {
  ToolCallGistLine,
  ToolCallGistValues,
  ToolCallIdentity,
  ToolCallInput,
  ToolCallOutput,
} from "@/components/ui/ToolCall";
import {
  isDelegationToolName,
  parseDelegationEnvelope,
} from "@/lib/delegation/delegationEnvelope";
import { useSidecarLocalTrace } from "@/lib/desktopSidecar/localTraceStore";
import { gistOf } from "@/lib/toolCallGist/gist";
import { gistPlainLine } from "@/lib/toolCallGist/gistLabels";
import { resultLinkOf } from "@/lib/toolCallGist/resultLink";
import { isRecord, serverFailureMessage } from "@/lib/toolCallGist/serverText";

import { SidecarLocalTraceSubtree } from "../SidecarLocalTraceSubtree";
import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";
import { DelegationStep } from "./DelegationStep";
import { refusedWithoutDecision, ToolDecisionRow } from "./ToolDecisionRow";
import { ToolStatusPill } from "./ToolStatusPill";

import type { ToolDecision } from "../Trace";
import type { BaseStepProps } from "../types";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Gist, GistItem, GistPhase } from "@/lib/toolCallGist/gist";
import type { ResultLink as ResultLinkData } from "@/lib/toolCallGist/resultLink";
import type { CleanText } from "@/lib/toolCallGist/serverText";

interface ToolUseStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
  decision?: ToolDecision;
}

/**
 * A result's link, named after the server only when it points at the
 * server's own host; any other link says where it goes.
 */
const ResultLink = ({
  link,
  server,
}: {
  link: ResultLinkData;
  server: string | undefined;
}) => {
  const host = link.host;
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      title={link.title}
      dir="auto"
      className="shrink-0 px-1 text-xs text-theme-fg-accent [unicode-bidi:isolate] hover:underline"
      data-testid="tool-result-link"
    >
      {link.onServer && server
        ? t({ id: "trace.tool.openIn", message: `Open in ${server}` })
        : t({ id: "trace.tool.openLinkHost", message: `Open link - ${host}` })}
    </a>
  );
};

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const hasRowValues = (item: GistItem) =>
  item.fields.length > 0 || item.before.length > 0 || item.count > 1;

/**
 * What stays visible under a gist row: the key values and old → new of each
 * item, further items' own lines, and a failed call's message from its server.
 */
const GistRowDetails = ({
  gist,
  phase,
  failure,
}: {
  gist: Gist;
  phase: GistPhase;
  failure: CleanText | undefined;
}) => (
  <div className="space-y-1">
    {gist.items.map((item, index) => (
      <div key={index} className="space-y-1">
        {index > 0 && (
          <p className="text-xs text-theme-fg-secondary">
            <ToolCallGistLine gist={gist} item={item} phase={phase} />
          </p>
        )}
        {hasRowValues(item) && <ToolCallGistValues item={item} variant="row" />}
      </div>
    ))}
    {failure && (
      <p
        dir="auto"
        className="whitespace-pre-wrap break-words text-xs text-theme-error-fg [overflow-wrap:anywhere] [unicode-bidi:isolate]"
        data-testid="tool-failure-message"
      >
        {failure.truncated ? `${failure.text}…` : failure.text}
      </p>
    )}
  </div>
);

// The server's cap; rows and events from other writers get it here.
const MAX_PROGRESS_CHARS = 200;

const progressText = (message: unknown): string | undefined => {
  if (typeof message !== "string") return undefined;
  const text = Array.from(message.slice(0, MAX_PROGRESS_CHARS * 2))
    .slice(0, MAX_PROGRESS_CHARS)
    .join("")
    .trim();
  return text.length > 0 ? text : undefined;
};

const PlainToolUseStep = ({
  part,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
  decision,
}: ToolUseStepProps) => {
  const resolvedStatus = part.status;
  const isRunning = status === "running" && isStreaming;
  const toolName = part.tool_name ?? "";
  const toolCallId = part.tool_call_id;
  // A denied or refused call never ran: its decision row says so.
  const notRun =
    decision?.status === "denied" || refusedWithoutDecision(part, decision);
  const label = part.display?.label;
  const gist = useMemo(() => gistOf(label, part.input), [label, part.input]);
  const serverName = textOf(part.display?.server_name);
  const lead = gist?.items[0];
  const phase: GistPhase = notRun
    ? "ask"
    : part.status === "success"
      ? "done"
      : part.status === "error"
        ? "failed"
        : "ask";
  const failure =
    gist && phase === "failed" ? serverFailureMessage(part.output) : undefined;
  const showsDetails =
    gist !== undefined &&
    (failure !== undefined ||
      gist.items.length > 1 ||
      gist.items.some(hasRowValues));
  const link = useMemo(
    () =>
      part.status === "success" ? resultLinkOf(part.result_details) : undefined,
    [part.status, part.result_details],
  );
  const progress = progressText(part.progress_message);

  // The sidecar's on-device steps are the step's body: rows like the main
  // line, each with its own toggle for its own details. This step's toggle
  // folds and unfolds them, open by default so they stream in visibly. A
  // trace-bearing call shows no tool-level payload JSON at all — real input
  // and output only ever belong to an individual step.
  const hasTrace =
    useSidecarLocalTrace(toolCallId, toolName, part.output) !== undefined;

  const payload =
    toolCallId && hasTrace ? (
      <SidecarLocalTraceSubtree
        toolCallId={toolCallId}
        toolName={toolName}
        output={part.output}
      />
    ) : part.input != null || part.output != null ? (
      <div className="space-y-3 py-2">
        {part.input != null && <ToolCallInput input={part.input} />}
        {part.output != null && (
          <ToolCallOutput output={part.output} isError={status === "error"} />
        )}
      </div>
    ) : undefined;
  // A gist row's title is the line, so the tool it ran is named in the body.
  const body = gist ? (
    <>
      <ToolCallIdentity
        className="pt-2"
        toolName={toolName}
        server={serverName}
      />
      {payload}
    </>
  ) : (
    payload
  );

  return (
    // The `data-testid`/`data-tool-name`/`data-tool-status` attributes on the
    // wrapper expose a stable, mode-agnostic test handle. Tests can target a
    // tool call by name regardless of whether the trace is currently expanded
    // (streaming) or collapsed behind the cold-load summary pill — DOM-based
    // locators don't filter by visibility, only presence.
    <div
      data-testid="tool-call-item"
      data-tool-name={toolName}
      data-tool-status={resolvedStatus}
    >
      <ToolDecisionRow part={part} decision={decision} />
      <TraceStep
        railIcon={railIconFor(part.content_type, status)}
        hasTrailingRailLine={!isLastStep}
        title={
          <>
            {gist && lead ? (
              <span
                title={gistPlainLine(gist, lead, phase)}
                data-testid="tool-call-gist-line"
              >
                <ToolCallGistLine gist={gist} item={lead} phase={phase} />
              </span>
            ) : (
              toolName
            )}
            {part.display?.server_name && (
              <span
                dir="auto"
                className="pl-2 font-normal text-theme-fg-muted [unicode-bidi:isolate]"
              >
                {part.display.server_name}
              </span>
            )}
            {progress && (
              <span
                dir="auto"
                className="pl-2 font-normal text-theme-fg-muted [unicode-bidi:isolate]"
                title={progress}
              >
                {progress}
              </span>
            )}
          </>
        }
        titleSlot={
          notRun ? undefined : (
            <ToolStatusPill
              status={status}
              label={
                part.status === "preparing" && status !== "interrupted"
                  ? t({ id: "trace.tool.preparing", message: "Preparing" })
                  : undefined
              }
            />
          )
        }
        headerSlot={link && <ResultLink link={link} server={serverName} />}
        detailSlot={
          gist && showsDetails ? (
            <GistRowDetails gist={gist} phase={phase} failure={failure} />
          ) : undefined
        }
        defaultOpen={hasTrace}
        autoExpand={hasTrace}
        autoCollapse={isCollapsed}
        isActive={isRunning}
      >
        {body}
      </TraceStep>
    </div>
  );
};

/** The call as rows saved before labels show it: no gist and no result link. */
const withoutLabel = (
  part: ToolUseStepProps["part"],
): ToolUseStepProps["part"] => {
  const display: unknown = part.display;
  return {
    ...part,
    display: isRecord(display)
      ? {
          title: textOf(display.title) ?? part.tool_name ?? "",
          description_truncated: false,
          server_name: textOf(display.server_name),
          read_only:
            typeof display.read_only === "boolean"
              ? display.read_only
              : undefined,
        }
      : undefined,
    result_details: undefined,
  };
};

// A refusal, and every frame before the first progress update, has no run to
// show — those render as the plain tool call. Branching at this level rather
// than inside keeps each rendering free to hold its own hooks.
export const ToolUseStep = (props: ToolUseStepProps) => {
  const envelope = isDelegationToolName(props.part.tool_name)
    ? parseDelegationEnvelope(props.part.output)
    : undefined;
  return envelope ? (
    <DelegationStep {...props} envelope={envelope} />
  ) : (
    // A label or result this build cannot render leaves the row as it was
    // before labels, never a broken message.
    <ErrorBoundary
      resetKeys={[props.part]}
      fallback={<PlainToolUseStep {...props} part={withoutLabel(props.part)} />}
    >
      <PlainToolUseStep {...props} />
    </ErrorBoundary>
  );
};
