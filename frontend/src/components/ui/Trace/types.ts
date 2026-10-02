import type { ReasoningSegment } from "./hooks/useReasoningSegments";
import type {
  ContentPart,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Content parts eligible for a trace, including decision metadata that
 * settles a budget request without adding another row. Text parts are rendered
 * separately as the assistant's final answer and never appear in the trace.
 */
export type TraceablePart =
  | Extract<
      ContentPart,
      {
        content_type:
          | "reasoning"
          | "tool_use"
          | "tool_approval"
          | "tool_rejection";
      }
    >
  | (Extract<ContentPart, { content_type: "tool_approval_request" }> & {
      kind: "tool_call_limit";
    });

/**
 * Discriminator narrowing helper — keep in sync with `TraceablePart`.
 */
export const isTraceablePart = (part: ContentPart): part is TraceablePart =>
  part.content_type === "reasoning" ||
  part.content_type === "tool_use" ||
  part.content_type === "tool_approval" ||
  part.content_type === "tool_rejection" ||
  (part.content_type === "tool_approval_request" &&
    part.kind === "tool_call_limit");

/**
 * Visual status of a single step. Used to pick the rail icon and pulse state.
 *
 * - `running`  – step is the live tail of an ongoing stream (current writer)
 * - `done`     – step finished successfully
 * - `error`    – step ended in an error (only meaningful for tool calls today)
 * - `interrupted` – step never finished and nothing is left to finish it
 *   (the writing process died mid-call). Distinct from `error`: the call did
 *   not fail, it was abandoned, and the distinction is what stops the rail
 *   from reporting an unfinished call as a success.
 */
export type TraceStepStatus = "running" | "done" | "error" | "interrupted";

/**
 * One renderable row in the timeline. Reasoning ContentParts may expand into
 * multiple logical steps (one per `**Header**` section); tool_use parts are
 * always 1:1.
 */
export type LogicalStep =
  | {
      kind: "tool_budget_approval";
      key: string;
      approvalStatus: "approved" | "denied";
    }
  | {
      kind: "reasoning";
      /** Stable React key derived from part + segment indices. */
      key: string;
      segment: ReasoningSegment;
    }
  | {
      kind: "tool_use";
      /** Stable React key derived from the tool_call_id. */
      key: string;
      part: ToolUse & { content_type: "tool_use" };
    };

/**
 * Props common to every per-kind step component. Each kind extends with its
 * own data-bearing props.
 */
export interface BaseStepProps {
  /** Visual / a11y state for this step. */
  status: TraceStepStatus;
  /** True while the trace cluster is the active writer. */
  isStreaming: boolean;
  /** When true, the body is auto-collapsed (later content has appeared). */
  isCollapsed: boolean;
  /** True when this is the bottom of the timeline (no rail line below). */
  isLastStep: boolean;
}
