import { isDelegationToolName } from "@/lib/delegation/delegationEnvelope";

import type { LogicalStep } from "@/components/ui/Trace/types";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type ToolCall = ToolUse & { content_type: "tool_use" };
type ToolStep = Extract<LogicalStep, { kind: "tool_use" }>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const outputOf = (call: ToolCall): Record<string, unknown> | undefined => {
  const output: unknown = call.output;
  return record(output) ? output : undefined;
};

/** The backend adds `part` to the result of every call that stages a part of a submission. */
const isPartCall = (call: ToolCall) => record(outputOf(call)?.part);

/** And `submission` to the result of every call of the submission that finishes it. */
const isSubmissionCall = (call: ToolCall) => record(outputOf(call)?.submission);

const isToolStep = (step: LogicalStep): step is ToolStep =>
  step.kind === "tool_use";

/** How a call ended its submission, by the outcome the backend recorded on it. */
function endOf(call: ToolCall): "accepted" | "unresolved" | undefined {
  const output = outputOf(call);
  const submission = record(output?.submission) ? output.submission : {};
  const outcome = record(output?.submission_outcome)
    ? output.submission_outcome
    : {};
  if (outcome.status === "unresolved" || submission.status === "failed")
    return "unresolved";
  if (submission.status === "accepted" && call.status === "success")
    return "accepted";
  return undefined;
}

/** How the step of `calls` ended; undefined while it is open. */
export const submissionEnd = (
  calls: readonly ToolCall[],
): "accepted" | "unresolved" | undefined =>
  calls.map(endOf).findLast((end) => end !== undefined);

/** A call that failed while the step went on: a part or attempt Erato sent again. */
const gotPast = (call: ToolCall) =>
  call.status === "error" && endOf(call) === undefined;

/** What leads into the first part call; another server's call or a delegated task keeps its row. */
const leadsIn = (step: LogicalStep) =>
  step.kind === "reasoning" ||
  (isToolStep(step) &&
    !step.part.display?.server_name &&
    !isDelegationToolName(step.part.tool_name));

/** Folds a submission in parts into one step, by what the backend recorded on each call's result;
 * while the step is open, everything after its first part call belongs to it. */
export function groupSubmissionSteps(steps: LogicalStep[]): LogicalStep[] {
  const recorded = steps.filter(isToolStep);
  if (!recorded.some((step) => isPartCall(step.part))) return steps;
  const tools = new Set(
    recorded
      .filter((step) => isPartCall(step.part) || isSubmissionCall(step.part))
      .map((step) => step.part.tool_name),
  );
  const member = (step: LogicalStep) =>
    isToolStep(step) &&
    (isPartCall(step.part) ||
      isSubmissionCall(step.part) ||
      (step.part.output == null && tools.has(step.part.tool_name)));
  const firstPart = steps.findIndex(
    (step) => isToolStep(step) && isPartCall(step.part),
  );
  let start = firstPart;
  while (start > 0 && leadsIn(steps[start - 1])) start--;
  const calls = (from: number, to: number) =>
    steps
      .slice(from, to + 1)
      .filter(isToolStep)
      .map((step) => step.part);
  const lastMember = steps.findLastIndex(member);
  const end = submissionEnd(calls(firstPart, lastMember))
    ? lastMember
    : steps.length - 1;
  const inner = steps.slice(start, end + 1);
  return [
    ...steps.slice(0, start),
    {
      kind: "submission",
      key: `s-${steps[firstPart].key}`,
      steps: inner.filter((step) => !isToolStep(step) || !gotPast(step.part)),
      calls: calls(start, end),
    },
    ...steps.slice(end + 1),
  ];
}
