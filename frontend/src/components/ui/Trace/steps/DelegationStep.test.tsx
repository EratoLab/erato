import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useSidecarLocalTraceStore } from "@/lib/desktopSidecar/localTraceStore";
import { recentChatsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { DelegatedRunOpenProvider } from "@/providers/DelegatedRunOpenProvider";

import { ToolUseStep } from "./ToolUseStep";

import type {
  RecentChat,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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

// A fresh client per test: the live-status overlay reads cached
// recent-chats rows, and tests seed them explicitly.
let queryClient: QueryClient;

const renderStep = (output: unknown, toolName?: string, streaming = true) =>
  render(
    <QueryClientProvider client={queryClient}>
      <ToolUseStep
        part={part(output, toolName)}
        status={streaming ? "running" : "done"}
        isStreaming={streaming}
        isCollapsed={false}
        isLastStep
      />
    </QueryClientProvider>,
  );

/** Seed the origin-filtered delegated-runs listing the overlay resolves from. */
const seedRunListing = (chats: Partial<RecentChat>[]) =>
  queryClient.setQueryData(
    recentChatsQuery({
      queryParams: {
        origin_chat_id: "origin-1",
        include_delegated: true,
        limit: 50,
      },
    }).queryKey,
    {
      chats,
      stats: {
        current_offset: 0,
        has_more: false,
        returned_count: chats.length,
        total_count: chats.length,
      },
    },
  );

/** Whether the node sits inside a collapsed (0fr) trace body. */
const isFolded = (node: HTMLElement): boolean =>
  node.closest('div[style*="0fr"]') !== null;

describe("delegation step", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });
  afterEach(() => {
    useSidecarLocalTraceStore.setState({ traces: {} });
    useGenerationStatusStore.getState().reset();
  });

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
      <QueryClientProvider client={queryClient}>
        <ToolUseStep
          part={part({
            ...IDENTITY,
            localTrace: {
              steps: [
                {
                  sequence: 0,
                  id: "search_web",
                  status: "ok",
                  durationMs: 900,
                },
                { sequence: 1, id: "answer", status: "running" },
              ],
            },
          })}
          status="running"
          isStreaming
          isCollapsed={false}
          isLastStep
        />
      </QueryClientProvider>,
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

  it("settles a backgrounded dispatch the moment it lands, mid-stream", () => {
    renderStep({ ...IDENTITY, background: true });

    expect(screen.getByText("Delegated to Research")).toBeInTheDocument();
    const pill = screen.getByText("Sent to background");
    expect(pill).not.toHaveClass("bg-theme-error-bg");
    expect(pill).not.toHaveClass("animate-pulse");
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("keeps the backgrounded presentation frozen after the turn ends", () => {
    renderStep({ ...IDENTITY, background: true }, undefined, false);

    expect(screen.getByText("Delegated to Research")).toBeInTheDocument();
    expect(screen.getByText("Sent to background")).toBeInTheDocument();
    const link = screen.getByTestId("delegation-open-run");
    expect(link).toHaveAttribute("href", "/a/asst-1/chat-7");
    expect(link).toHaveAttribute("target", "_blank");
    // Nothing to unfold: the part will never carry steps or a result.
    expect(
      screen.queryByRole("button", { name: /Delegated to Research/ }),
    ).toBeNull();
  });

  it("opens the run through the host's opener when one is provided", () => {
    const openRun = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DelegatedRunOpenProvider onOpen={openRun}>
          <ToolUseStep
            part={part({ ...IDENTITY, background: true })}
            status="done"
            isStreaming={false}
            isCollapsed={false}
            isLastStep
          />
        </DelegatedRunOpenProvider>
      </QueryClientProvider>,
    );

    const control = screen.getByTestId("delegation-open-run");
    // No href: a host that supplies an opener serves no chat routes for a
    // new tab to land on.
    expect(control.tagName).toBe("BUTTON");
    expect(control).not.toHaveAttribute("href");

    fireEvent.click(control);
    expect(openRun).toHaveBeenCalledWith("chat-7");
  });

  it("says the detachment even over an approval decision", () => {
    // ToolStatusPill gives an approval decision top priority; the background
    // branch must win before it ever gets the chance.
    render(
      <QueryClientProvider client={queryClient}>
        <ToolUseStep
          part={part({ ...IDENTITY, background: true })}
          status="done"
          isStreaming={false}
          isCollapsed={false}
          isLastStep
          approvalStatus="approved"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Sent to background")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).toBeNull();
  });

  it("overlays the live state while the run is genuinely running, then its outcome", () => {
    act(() => {
      useGenerationStatusStore
        .getState()
        .seedRunning("chat-7", "2026-08-19T12:00:00.000Z");
    });
    renderStep({ ...IDENTITY, background: true }, undefined, false);

    const running = screen.getByText("Running in the background");
    expect(running).toHaveClass("animate-pulse");
    expect(screen.queryByText("Sent to background")).toBeNull();

    // The same client observes the run end badly; the pill follows.
    act(() => {
      useGenerationStatusStore.getState().markTerminalLocal("chat-7", "error");
    });
    const failed = screen.getByText("Failed in the background");
    expect(failed).toHaveClass("bg-theme-error-bg");
    expect(failed).not.toHaveClass("animate-pulse");
  });

  it("overlays the durable outcome from a cached listing row", () => {
    // What a reload leaves behind: no store entry, but the origin-filtered
    // listing (refetched on mount) carries the run's durable outcome.
    seedRunListing([{ id: "chat-7", delegated_run_outcome: "completed" }]);
    renderStep({ ...IDENTITY, background: true }, undefined, false);

    const pill = screen.getByText("Finished in the background");
    expect(pill).toHaveClass("bg-theme-success-bg");
    expect(screen.queryByText("Sent to background")).toBeNull();
  });

  it("falls back to the neutral hand-off copy when nothing is known", () => {
    // A listing that no longer contains the run says nothing about it.
    seedRunListing([{ id: "chat-other", delegated_run_outcome: "completed" }]);
    renderStep({ ...IDENTITY, background: true }, undefined, false);

    expect(screen.getByText("Sent to background")).toBeInTheDocument();
    expect(screen.queryByText("Running in the background")).toBeNull();
    expect(screen.queryByText("Finished in the background")).toBeNull();
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
    ["a background marker with no run", { background: true }],
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
