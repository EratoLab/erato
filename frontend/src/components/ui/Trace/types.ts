import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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
 * Props common to every per-type step component. Each kind extends with its
 * own data-bearing props.
 */
export interface BaseStepProps {
  /** Position in the trace, used for keys and animations. */
  index: number;
  /** Visual / a11y state for this step. */
  status: TraceStepStatus;
  /** When true, renders the cursor caret on the live text. */
  isStreaming: boolean;
  /** When true, the body is auto-collapsed (later content has appeared). */
  isCollapsed: boolean;
  /** Pre-built markdown renderer from the parent. */
  renderMarkdown: (text: string) => React.ReactNode;
}
