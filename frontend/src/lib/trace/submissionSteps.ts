import { isDelegationToolName } from "@/lib/delegation/delegationEnvelope";

import type { LogicalStep } from "@/components/ui/Trace/types";
import type {
  ContentPart,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type ToolCall = ToolUse & { content_type: "tool_use" };
type ToolStep = Extract<LogicalStep, { kind: "tool_use" }>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const outputOf = (call: ToolCall): Record<string, unknown> | undefined => {
  const output: unknown = call.output;
  return record(output) ? output : undefined;
};

/** Another server's result is stored as the server wrote it, so only Erato's own calls are read. */
const ownCall = (call: ToolCall) =>
  !call.display?.server_name && !isDelegationToolName(call.tool_name);

/** The backend adds what is left of the part budget to the result of every call that stages a part. */
const isPartCall = (call: ToolCall) => {
  const part = outputOf(call)?.part;
  return (
    ownCall(call) &&
    record(part) &&
    typeof part.tries_remaining === "number" &&
    typeof part.calls_remaining === "number"
  );
};

/** And `submission` to the result of every call of the submission that finishes it. */
const isSubmissionCall = (call: ToolCall) => {
  const submission = outputOf(call)?.submission;
  return (
    ownCall(call) && record(submission) && typeof submission.status === "string"
  );
};

const isToolStep = (step: LogicalStep): step is ToolStep =>
  step.kind === "tool_use";

/** How a call ended its submission, by the outcome the backend recorded on it. */
function endOf(call: ToolCall): "accepted" | "unresolved" | undefined {
  if (!isPartCall(call) && !isSubmissionCall(call)) return undefined;
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

/** How the submission of `calls` ended; undefined while no call records its end. */
export const submissionEnd = (
  calls: readonly ToolCall[],
): "accepted" | "unresolved" | undefined =>
  calls.map(endOf).findLast((end) => end !== undefined);

/**
 * Where a submission in parts runs in a message's content: from its first part call to the call
 * that ended it, or to the end of the content while it is open. Text written between its calls
 * goes after its step, so the step stays one.
 */
export function submissionSpan(
  content: readonly ContentPart[],
): { from: number; to: number } | undefined {
  const calls = content.flatMap((part, index) =>
    part.content_type === "tool_use" ? [{ call: part, index }] : [],
  );
  const first = calls.find(({ call }) => isPartCall(call));
  if (!first) return undefined;
  const members = calls.filter(
    ({ call, index }) =>
      index >= first.index && (isPartCall(call) || isSubmissionCall(call)),
  );
  const last = members.at(-1) ?? first;
  return {
    from: first.index,
    to: submissionEnd(members.map(({ call }) => call))
      ? last.index
      : content.length - 1,
  };
}

/** Another server's call, a delegated task or a budget decision keeps a row of its own. */
const foreign = (step: LogicalStep) =>
  step.kind === "tool_budget_approval" ||
  (isToolStep(step) && !ownCall(step.part));

/**
 * Folds a submission in parts into one step, by what the backend recorded on each call's result:
 * the reads and thinking just before its first part call, and everything of Erato's own after it
 * until the call that ended it. Rows of their own inside that span follow the step.
 */
export function groupSubmissionSteps(steps: LogicalStep[]): LogicalStep[] {
  const firstPart = steps.findIndex(
    (step) => isToolStep(step) && isPartCall(step.part),
  );
  if (firstPart < 0) return steps;
  const counted = (call: ToolCall) =>
    isPartCall(call) || isSubmissionCall(call);
  const tools = new Set(
    steps
      .filter(isToolStep)
      .filter((step) => counted(step.part))
      .map((step) => step.part.tool_name),
  );
  // A call still being written has no result yet; it joins by its tool's earlier calls.
  const member = (step: LogicalStep): step is ToolStep =>
    isToolStep(step) &&
    (counted(step.part) ||
      (step.part.output == null &&
        ownCall(step.part) &&
        tools.has(step.part.tool_name)));
  let start = firstPart;
  while (start > 0 && !foreign(steps[start - 1])) start--;
  const lastMember = steps.findLastIndex(member);
  const end = submissionEnd(
    steps
      .slice(firstPart, lastMember + 1)
      .filter(member)
      .map((s) => s.part),
  )
    ? lastMember
    : steps.length - 1;
  const span = steps.slice(start, end + 1);
  const inner = span.filter((step) => !foreign(step));
  // A part or attempt that failed without ending the submission was sent again.
  const sentAgain = (step: LogicalStep) =>
    member(step) &&
    step.part.status === "error" &&
    endOf(step.part) === undefined;
  return [
    ...steps.slice(0, start),
    {
      kind: "submission",
      key: `s-${steps[firstPart].key}`,
      steps: inner.filter((step) => !sentAgain(step)),
      calls: inner.filter(isToolStep).map((step) => step.part),
    },
    ...span.filter(foreign),
    ...steps.slice(end + 1),
  ];
}
