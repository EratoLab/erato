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

  it("calls an unfinished tool call interrupted once nothing is left to finish it", () => {
    expect(stepStatus(toolStep("in_progress"), true, false)).toBe(
      "interrupted",
    );
    expect(stepStatus(toolStep("in_progress"), false, false)).toBe(
      "interrupted",
    );
  });

  it("never reports an unfinished call as a success", () => {
    // The regression this rule exists for: a crash-orphaned call used to
    // render with the rail's green check, asserting an outcome it never had.
    expect(stepStatus(toolStep("in_progress"), true, false)).not.toBe("done");
    expect(stepStatus(toolStep("preparing"), true, false)).not.toBe("done");
  });

  it("leaves an unfinished call alone while the chat still owes an outcome", () => {
    // A turn parked on an approval, or one generating on another replica,
    // will settle the part later — that is not an orphan.
    expect(stepStatus(toolStep("in_progress"), true, false, true)).toBe("done");
    expect(stepStatus(toolStep("in_progress"), false, false, true)).toBe(
      "done",
    );
  });

  it("keeps a settled call's own outcome regardless of the chat's state", () => {
    expect(stepStatus(toolStep("success"), true, false)).toBe("done");
    expect(stepStatus(toolStep("error"), true, false)).toBe("error");
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

describe("stepStatus for a call the turn is parked on", () => {
  const WAITING = "call-a";

  it("waits with the chat busy, where the flag alone drew a check", () => {
    // `action_required` is what a parked call reads as on this page.
    expect(
      stepStatus(toolStep("in_progress"), true, false, true, WAITING),
    ).toBe("waiting");
    expect(
      stepStatus(toolStep("in_progress"), false, false, true, WAITING),
    ).toBe("waiting");
  });

  it("waits with the chat not busy, where the flag alone said Interrupted", () => {
    // A poll that read the chat as ended, or a page with no status for it.
    expect(
      stepStatus(toolStep("in_progress"), true, false, false, WAITING),
    ).toBe("waiting");
    expect(stepStatus(toolStep("preparing"), true, false, false, WAITING)).toBe(
      "waiting",
    );
  });

  it("waits while its trace is still the page's writer", () => {
    expect(
      stepStatus(toolStep("in_progress"), true, true, false, WAITING),
    ).toBe("waiting");
  });

  it("takes a returned call's own outcome, so Share ends on done", () => {
    expect(stepStatus(toolStep("success"), true, false, false, WAITING)).toBe(
      "done",
    );
    expect(stepStatus(toolStep("error"), true, false, true, WAITING)).toBe(
      "error",
    );
  });

  it("leaves every call the turn is not parked on as it was", () => {
    const other = toolStep("in_progress", "call-b");
    expect(stepStatus(other, true, true, false, WAITING)).toBe("running");
    expect(stepStatus(other, true, false, true, WAITING)).toBe("done");
    // Nothing can finish an unfinished call the row does not wait on.
    expect(stepStatus(other, true, false, false, WAITING)).toBe("interrupted");
  });

  it("never makes reasoning wait", () => {
    expect(
      stepStatus(reasoningStep(WAITING), true, false, false, WAITING),
    ).toBe("done");
  });
});
