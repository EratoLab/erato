import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useId, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { DisclosureButton } from "@/components/ui/Controls/Disclosure";
import {
  changeRowHasDetails,
  ToolCallChangeRowDetails,
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
import {
  changeRowCounts,
  machineIdPhrase,
} from "@/lib/toolCallGist/changeLabels";
import { gistOf } from "@/lib/toolCallGist/gist";
import { gistPlainLine } from "@/lib/toolCallGist/gistLabels";
import { maskMachineIds } from "@/lib/toolCallGist/machineId";
import { ownProposalOf } from "@/lib/toolCallGist/ownProposal";
import {
  commentChangeRow,
  commentChangesMore,
  isMixedCommentProposal,
  ownProposalLine,
} from "@/lib/toolCallGist/ownProposalLabels";
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
import type { WordCommentOp } from "@/lib/wordReview/wordCommentChanges";

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

/** A failure message longer than this is one line until it is opened. */
const FAILURE_LINE_CHARS = 90;

/**
 * A failed call: Erato's own line that it failed, in the row's failure
 * colour, then the server's message as the tool's word, its machine IDs
 * masked as on the card, on one line until it is opened.
 */
const FailureMessage = ({ failure }: { failure: CleanText }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = maskMachineIds(failure.text, machineIdPhrase());
  const shown = failure.truncated ? `${text}…` : text;
  const long =
    failure.truncated ||
    text.includes("\n") ||
    Array.from(text).length > FAILURE_LINE_CHARS;
  return (
    <div className="space-y-0.5 text-xs" data-testid="tool-failure">
      <p className="text-theme-error-fg">
        {t({ id: "trace.tool.failure.line", message: "The call failed." })}
      </p>
      <p
        id={id}
        className={clsx(
          "text-theme-fg-secondary",
          open || !long
            ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            : "truncate",
        )}
      >
        {t({ id: "trace.tool.failure.toolSays", message: "The tool says:" })}{" "}
        <q
          dir="auto"
          className="[unicode-bidi:isolate]"
          data-testid="tool-failure-message"
        >
          {shown}
        </q>
      </p>
      {long && (
        <DisclosureButton
          open={open}
          controls={id}
          onToggle={() => {
            setOpen(!open);
          }}
        >
          <span className="text-xs">
            {open
              ? t({
                  id: "trace.tool.failure.showLess",
                  message: "Show less of the message",
                })
              : t({
                  id: "trace.tool.failure.showAll",
                  message: "Show the whole message",
                })}
          </span>
        </DisclosureButton>
      )}
    </div>
  );
};

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
    {gist.change
      ? phase === "done" && <ToolCallChangeRowDetails change={gist.change} />
      : gist.items.map((item, index) => (
          <div key={index} className="space-y-1">
            {index > 0 && (
              <p className="text-xs text-theme-fg-secondary">
                <ToolCallGistLine gist={gist} item={item} phase={phase} />
              </p>
            )}
            {hasRowValues(item) && (
              <ToolCallGistValues item={item} variant="row" />
            )}
          </div>
        ))}
    {failure && <FailureMessage failure={failure} />}
  </div>
);

/** Rows a mixed comment batch lists; the rest are counted. */
const MAX_CHANGE_ROWS = 50;

/** A mixed comment batch's changes, one row each, by operation only. */
const CommentChangeRows = ({
  changes,
}: {
  changes: readonly (WordCommentOp | "other")[];
}) => {
  const more = changes.length - MAX_CHANGE_ROWS;
  return (
    <ol
      className="list-decimal space-y-0.5 pl-5 pt-2 text-xs text-theme-fg-secondary"
      data-testid="tool-call-proposal-changes"
    >
      {changes.slice(0, MAX_CHANGE_ROWS).map((op, index) => (
        <li key={index} data-op={op}>
          {commentChangeRow(op)}
        </li>
      ))}
      {more > 0 && (
        <li
          className="list-none text-theme-fg-muted"
          data-testid="tool-call-proposal-changes-more"
        >
          {commentChangesMore(more)}
        </li>
      )}
    </ol>
  );
};

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
  // Erato's own proposals have cards of their own: the row only names them.
  const proposal = useMemo(
    () => ownProposalOf(label, part.input),
    [label, part.input],
  );
  const gist = useMemo(
    () => (proposal ? undefined : gistOf(label, part.input)),
    [proposal, label, part.input],
  );
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
      (gist.change
        ? phase === "done" && changeRowHasDetails(gist.change)
        : gist.items.length > 1 || gist.items.some(hasRowValues)));
  // Effects are facts only once the call has run.
  const counts =
    gist?.change && phase === "done" ? changeRowCounts(gist.change) : undefined;
  // "Updated task X: 2 changed"; a line that names nothing gets no colon.
  const named =
    lead?.names.some((name) => !lead.hiddenIdPaths.includes(name.path)) ===
    true;
  const server = part.display?.server_name && (
    <span
      dir="auto"
      className="pl-2 font-normal text-theme-fg-muted [unicode-bidi:isolate]"
    >
      {part.display.server_name}
    </span>
  );
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
                {counts !== undefined && named && ":"}
              </span>
            ) : (
              toolName
            )}
            {counts === undefined && server}
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
        titleAfter={
          counts === undefined ? undefined : (
            <>
              {!named && "· "}
              {counts}
              {server}
            </>
          )
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
