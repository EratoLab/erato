import { t } from "@lingui/core/macro";

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
import { ownProposalOf } from "@/lib/toolCallGist/ownProposal";
import {
  commentChangeRow,
  isMixedCommentProposal,
  ownProposalLine,
} from "@/lib/toolCallGist/ownProposalLabels";
import { serverFailureMessage } from "@/lib/toolCallGist/serverText";

import { SidecarLocalTraceSubtree } from "../SidecarLocalTraceSubtree";
import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";
import { DelegationStep } from "./DelegationStep";
import { refusedWithoutDecision, ToolDecisionRow } from "./ToolDecisionRow";
import { ToolStatusPill } from "./ToolStatusPill";

import type { ToolDecision } from "../Trace";
import type { BaseStepProps } from "../types";
import type {
  ToolResultDetails,
  ToolResultLink,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Gist, GistItem, GistPhase } from "@/lib/toolCallGist/gist";
import type { CommentOp } from "@/lib/toolCallGist/ownProposal";
import type { CleanText } from "@/lib/toolCallGist/serverText";

interface ToolUseStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
  decision?: ToolDecision;
}

/** Only a result's resource links may become anchors; the backend keeps https ones. */
const resultLinkOf = (details: ToolResultDetails | undefined) =>
  details?.links?.find((link) => link.uri.startsWith("https://"));

const ResultLink = ({
  link,
  server,
}: {
  link: ToolResultLink;
  server: string | undefined;
}) => (
  <a
    href={link.uri}
    target="_blank"
    rel="noopener noreferrer"
    title={link.title ?? link.name}
    className="shrink-0 px-1 text-xs text-theme-fg-accent hover:underline"
    data-testid="tool-result-link"
  >
    {server
      ? t({ id: "trace.tool.openIn", message: `Open in ${server}` })
      : t({ id: "trace.tool.openLink", message: "Open link" })}
  </a>
);

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

/** A mixed comment batch's changes, one row each, by operation only. */
const CommentChangeRows = ({
  changes,
}: {
  changes: readonly (CommentOp | "other")[];
}) => (
  <ol
    className="list-decimal space-y-0.5 pl-5 pt-2 text-xs text-theme-fg-secondary"
    data-testid="tool-call-proposal-changes"
  >
    {changes.map((op, index) => (
      <li key={index} data-op={op}>
        {commentChangeRow(op)}
      </li>
    ))}
  </ol>
);

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
  // Erato's own proposals have cards of their own: the row only names them.
  const proposal = ownProposalOf(part.display?.label, part.input);
  const gist = proposal ? undefined : gistOf(part.display?.label, part.input);
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
  const link =
    part.status === "success" ? resultLinkOf(part.result_details) : undefined;

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
  const proposalLine = proposal && ownProposalLine(proposal, phase);
  // A gist row's title is the line, so the tool it ran is named in the body.
  const body =
    proposal || gist ? (
      <>
        {proposal?.kind === "comments" && isMixedCommentProposal(proposal) && (
          <CommentChangeRows changes={proposal.changes} />
        )}
        <ToolCallIdentity
          className="pt-2"
          toolName={toolName}
          server={part.display?.server_name}
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
            {proposalLine ? (
              <span title={proposalLine} data-testid="tool-call-proposal-line">
                {proposalLine}
              </span>
            ) : gist && lead ? (
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
            {part.progress_message && (
              <span
                dir="auto"
                className="pl-2 font-normal text-theme-fg-muted [unicode-bidi:isolate]"
                title={part.progress_message}
              >
                {part.progress_message}
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
        headerSlot={
          link && <ResultLink link={link} server={part.display?.server_name} />
        }
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
    <PlainToolUseStep {...props} />
  );
};
