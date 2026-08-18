import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSidecarLocalTraceStore } from "@/lib/desktopSidecar/localTraceStore";

import { ToolUseStep } from "./ToolUseStep";

import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const IDENTITY = {
  assistant_id: "asst-1",
  assistant_name: "Research",
  delegate_chat_id: "chat-7",
};

const part = (output: unknown, toolName = "delegate_to_assistant") =>
  ({
    content_type: "tool_use",
    tool_call_id: "call-delegate",
    tool_name: toolName,
    status: "in_progress",
    input: { prompt: "look it up" },
    output,
  }) as unknown as ToolUse & { content_type: "tool_use" };

const renderStep = (output: unknown, toolName?: string, streaming = true) =>
  render(
    <ToolUseStep
      part={part(output, toolName)}
      status={streaming ? "running" : "done"}
      isStreaming={streaming}
      isCollapsed={false}
      isLastStep
    />,
  );

/** Whether the node sits inside a collapsed (0fr) trace body. */
const isFolded = (node: HTMLElement): boolean =>
  node.closest('div[style*="0fr"]') !== null;

describe("delegation step", () => {
  afterEach(() => useSidecarLocalTraceStore.setState({ traces: {} }));

  it("names the delegate and shows its steps while the run is in flight", () => {
    renderStep({
      ...IDENTITY,
      localTrace: {
        steps: [{ sequence: 0, id: "search_web", status: "running" }],
      },
    });

    expect(
      screen.getByRole("button", { name: /Delegating to Research/ }),
    ).toHaveTextContent("Running");
    const trace = screen.getByTestId("delegation-trace");
    expect(isFolded(trace)).toBe(false);
    expect(screen.getByText("search_web")).toBeInTheDocument();
  });

  it("falls back to a neutral title when the envelope names no assistant", () => {
    renderStep({ delegate_chat_id: "chat-7" });
    expect(screen.getByText("Delegating to an assistant")).toBeInTheDocument();
  });

  it("accumulates steps across progress frames and supersedes by sequence", () => {
    const { rerender } = renderStep({
      ...IDENTITY,
      localTrace: {
        steps: [{ sequence: 0, id: "search_web", status: "running" }],
      },
    });

    rerender(
      <ToolUseStep
        part={part({
          ...IDENTITY,
          localTrace: {
            steps: [
              { sequence: 0, id: "search_web", status: "ok", durationMs: 900 },
              { sequence: 1, id: "answer", status: "running" },
            ],
          },
        })}
        status="running"
        isStreaming
        isCollapsed={false}
        isLastStep
      />,
    );

    expect(screen.getAllByText("search_web")).toHaveLength(1);
    expect(screen.getByText("Final answer")).toBeInTheDocument();
    expect(screen.getByText(/2 steps/)).toBeInTheDocument();
    expect(screen.getByText(/900 ms/)).toBeInTheDocument();
  });

  it("summarizes a completed run with its result", () => {
    renderStep(
      {
        ...IDENTITY,
        status: "completed",
        result: "The invoice is from March.",
        truncated: false,
        localTrace: { steps: [{ sequence: 0, id: "answer", status: "ok" }] },
      },
      undefined,
      false,
    );

    expect(screen.getByText("Delegated to Research")).toBeInTheDocument();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.getByText("The invoice is from March.")).toBeInTheDocument();
  });

  it("clips a long result and says when the backend clipped it too", () => {
    renderStep(
      {
        ...IDENTITY,
        status: "completed",
        result: "x".repeat(400),
        truncated: true,
      },
      undefined,
      false,
    );

    const summary = screen.getByTestId("delegation-result");
    expect(summary.textContent).toContain(`${"x".repeat(280)}…`);
    expect(summary.textContent).not.toContain("x".repeat(281));
    expect(screen.getByText("Result truncated")).toBeInTheDocument();
  });

  it.each([
    ["failed", "Failed"],
    ["timeout", "Timed out"],
    ["cancelled", "Cancelled"],
  ])("says what went wrong for a %s run", (status, label) => {
    renderStep({ ...IDENTITY, status }, undefined, false);

    const pill = screen.getByText(label);
    expect(pill).toHaveClass("bg-theme-error-bg");
    expect(screen.getByText("Delegated to Research")).toBeInTheDocument();
  });

  it("offers the delegated run in a new tab from the first frame on", () => {
    renderStep({ ...IDENTITY, localTrace: { steps: [] } });

    const link = screen.getByTestId("delegation-open-run");
    expect(link).toHaveAttribute("href", "/a/asst-1/chat-7");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links a run without an assistant to the plain chat route", () => {
    renderStep({ delegate_chat_id: "chat-7", assistant_name: "Research" });
    expect(screen.getByTestId("delegation-open-run")).toHaveAttribute(
      "href",
      "/chat/chat-7",
    );
  });

  it("keeps the step's fold state to itself when the link is clicked", () => {
    renderStep({
      ...IDENTITY,
      localTrace: {
        steps: [{ sequence: 0, id: "search_web", status: "running" }],
      },
    });

    const toggle = screen.getByRole("button", { name: /Delegating to/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByTestId("delegation-open-run"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it.each([
    ["a refusal", { status: "error", error: "delegation is disabled" }],
    ["no output yet", null],
    ["a foreign shape", { localTrace: { steps: [] } }],
    ["a non-object output", "delegated"],
  ])("renders %s as the plain tool call it is", (_case, output) => {
    renderStep(output);

    expect(
      screen.getByRole("button", { name: /delegate_to_assistant/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("delegation-trace")).toBeNull();
    expect(screen.queryByTestId("delegation-open-run")).toBeNull();
  });

  it("paints no nested trace for a tool that is not allowed to carry one", () => {
    renderStep(
      {
        ...IDENTITY,
        status: "completed",
        localTrace: {
          steps: [{ sequence: 0, id: "search_web", status: "ok" }],
        },
      },
      "impersonator",
    );

    expect(screen.queryByTestId("delegation-trace")).toBeNull();
    expect(screen.queryByTestId("sidecar-trace")).toBeNull();
    expect(screen.queryByText("search_web")).toBeNull();
  });
});
