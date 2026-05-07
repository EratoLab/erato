import type { ReasoningSegment } from "./hooks/useReasoningSegments";
import type {
  ContentPart,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The subset of `ContentPart` variants that surface as a step in the trace
 * timeline. Text parts are rendered separately as the assistant's final
 * answer and never appear in the trace.
 */
export type TraceablePart = Extract<
  ContentPart,
  { content_type: "reasoning" } | { content_type: "tool_use" }
>;

/**
 * Discriminator narrowing helper — keep in sync with `TraceablePart`.
 */
export const isTraceablePart = (part: ContentPart): part is TraceablePart =>
  part.content_type === "reasoning" || part.content_type === "tool_use";

/**
 * Visual status of a single step. Used to pick the rail icon and pulse state.
 *
 * - `running`  – step is the live tail of an ongoing stream (current writer)
 * - `done`     – step finished successfully
 * - `error`    – step ended in an error (only meaningful for tool calls today)
 */
export type TraceStepStatus = "running" | "done" | "error";

/**
 * One renderable row in the timeline. Reasoning ContentParts may expand into
 * multiple logical steps (one per `**Header**` section); tool_use parts are
 * always 1:1.
 */
export type LogicalStep =
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
