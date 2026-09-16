import { describe, expect, it } from "vitest";

import { stepStatus } from "./useTraceState";

import type { LogicalStep } from "../types";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const toolStep = (status: string, key = "call-a"): LogicalStep => ({
  kind: "tool_use",
  key,
  part: {
    content_type: "tool_use",
    tool_call_id: key,
    tool_name: "delegate_task",
    status,
    input: null,
    output: null,
  } as unknown as ToolUse & { content_type: "tool_use" },
});

const reasoningStep = (key = "reason-a"): LogicalStep => ({
  kind: "reasoning",
  key,
  segment: { title: "Weighing options", body: "thinking" },
});

describe("stepStatus", () => {
  it("runs an unfinished tool call wherever it sits in the timeline", () => {
    expect(stepStatus(toolStep("in_progress"), false, true)).toBe("running");
    expect(stepStatus(toolStep("in_progress"), true, true)).toBe("running");
  });

  it("settles every tool call once the trace stops writing", () => {
    expect(stepStatus(toolStep("in_progress"), true, false)).toBe("done");
    expect(stepStatus(toolStep("in_progress"), false, false)).toBe("done");
  });

  it("reads a finished tool call off its own status, not its position", () => {
    expect(stepStatus(toolStep("success"), false, true)).toBe("done");
    expect(stepStatus(toolStep("error"), true, true)).toBe("error");
    expect(stepStatus(toolStep("error"), false, false)).toBe("error");
  });

  it("still runs reasoning only at the tail, where it is written", () => {
    expect(stepStatus(reasoningStep(), true, true)).toBe("running");
    expect(stepStatus(reasoningStep(), false, true)).toBe("done");
    expect(stepStatus(reasoningStep(), true, false)).toBe("done");
  });
});
