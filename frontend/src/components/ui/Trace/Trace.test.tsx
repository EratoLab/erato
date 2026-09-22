import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { messages as enMessages } from "@/locales/en/messages.json";

import { Trace } from "./Trace";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

// Default mock: masking disabled
const mockUseTraceFeature = vi.fn(() => ({ maskReasoningText: false }));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useTraceFeature: () => mockUseTraceFeature(),
}));

const reasoningPart = (text: string): ContentPart => ({
  content_type: "reasoning",
  text,
});

const toolUsePart = (
  status: "success" | "error" | "in_progress" | "preparing" = "success",
): ContentPart => ({
  content_type: "tool_use",
  status,
  tool_call_id: "tool-abc",
  tool_name: "web_search",
  input: null,
  output: null,
  progress_message: null,
  started_at: null,
  ended_at: null,
});

const delegationToolUsePart = (): ContentPart =>
  ({
    content_type: "tool_use",
    status: "success",
    tool_call_id: "call-delegate",
    tool_name: "delegate_task",
    input: { task: "count the figures" },
    output: {
      status: "completed",
      delegate_chat_id: "child-chat-7",
      truncated: false,
    },
    progress_message: null,
    started_at: null,
    ended_at: null,
  }) as unknown as ContentPart;

const renderTrace = (
  parts: ContentPart[],
  overrides: {
    maskReasoningText?: boolean;
    toolApprovalStatuses?: Record<string, "approved" | "denied">;
  } = {},
) => {
  mockUseTraceFeature.mockReturnValue({
    maskReasoningText: overrides.maskReasoningText ?? false,
  });

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider i18n={i18n}>
        <Trace
          parts={parts as Parameters<typeof Trace>[0]["parts"]}
          isStreaming={false}
          hasLaterContent={false}
          renderMarkdown={(text) => <span>{text}</span>}
          durationMs={null}
          toolApprovalStatuses={overrides.toolApprovalStatuses}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
};

describe("Trace — a call the writer never finished", () => {
  const CHAT = "chat-under-test";

  beforeEach(() => {
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
  });

  it("marks a crash-orphaned tool call interrupted rather than done", () => {
    renderTrace([toolUsePart("in_progress")]);

    expect(screen.getByText("Interrupted")).toBeInTheDocument();
  });

  it("does not claim an unfinished call succeeded", () => {
    // The regression: on a cold load an `in_progress` part used to fall
    // through to `done` and draw the rail's green check.
    const { container } = renderTrace([toolUsePart("in_progress")]);

    expect(container.querySelector(".text-theme-success-fg")).toBeNull();
  });

  it("leaves the call alone while the chat is still generating", () => {
    useGenerationStatusStore.setState({
      currentChatId: CHAT,
      statusByChatId: {
        [CHAT]: {
          kind: "running",
          startedAt: new Date().toISOString(),
          localSeenAt: Date.now(),
        },
      },
    });

    renderTrace([toolUsePart("in_progress")]);

    expect(screen.queryByText("Interrupted")).toBeNull();
  });

  it("leaves the call alone while the chat is parked on an approval", () => {
    // `action_required` is a deliberate, server-durable park — the part is
    // unsettled on purpose and will be settled when the user answers.
    useGenerationStatusStore.setState({
      currentChatId: CHAT,
      statusByChatId: {
        [CHAT]: {
          kind: "action_required",
          startedAt: new Date().toISOString(),
          localSeenAt: Date.now(),
        },
      },
    });

    renderTrace([toolUsePart("in_progress")]);

    expect(screen.queryByText("Interrupted")).toBeNull();
  });

  it("still reports a genuinely failed call as failed", () => {
    renderTrace([toolUsePart("error")]);

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Interrupted")).toBeNull();
  });
});

describe("Trace — default (unmasked) mode", () => {
  it("renders reasoning segment title without masking", () => {
    renderTrace([
      reasoningPart("**Analyzing the request**\n\nLet me think through this."),
    ]);
    expect(screen.getByText("Analyzing the request")).toBeInTheDocument();
  });

  it("does not show the masked label when masking is disabled", () => {
    renderTrace([reasoningPart("Some reasoning text")], {
      maskReasoningText: false,
    });
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });
});

describe("Trace — masked mode (cold-load / done state)", () => {
  // isStreaming=false means all steps are in the "done" state,
  // so the static "Thinking complete" label is shown rather than the pulsing "Thinking…".
  it("shows the done label instead of model reasoning title when masked", () => {
    renderTrace(
      [reasoningPart("**Model reasoning title**\n\nModel reasoning body")],
      { maskReasoningText: true },
    );
    expect(screen.getByText("Thinking complete")).toBeInTheDocument();
    expect(screen.queryByText("Model reasoning title")).not.toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  it("does not render model-generated reasoning body when masked", () => {
    renderTrace([reasoningPart("Some reasoning body text")], {
      maskReasoningText: true,
    });
    expect(
      screen.queryByText("Some reasoning body text"),
    ).not.toBeInTheDocument();
  });

  it("still renders tool call steps when masking is enabled", () => {
    renderTrace([reasoningPart("Some reasoning"), toolUsePart()], {
      maskReasoningText: true,
    });
    // Done-state masked label for the reasoning step
    expect(screen.getByText("Thinking complete")).toBeInTheDocument();
    // Tool use step still renders normally
    expect(screen.getByText("web_search")).toBeInTheDocument();
  });

  it("shows an Approved badge beside an approved MCP tool call", () => {
    renderTrace([toolUsePart()], {
      toolApprovalStatuses: { "tool-abc": "approved" },
    });

    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("shows Denied instead of Failed for a rejected MCP tool call", () => {
    renderTrace([toolUsePart("error")], {
      toolApprovalStatuses: { "tool-abc": "denied" },
    });

    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("puts a decision recorded on the child's chat beside the step that dispatched it", () => {
    // A delegated decision names the child it was taken for, which is the only
    // id shared with the slot once the parent's call id has been rewritten.
    renderTrace([delegationToolUsePart()], {
      toolApprovalStatuses: { "child-chat-7": "approved" },
    });

    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("prefers the call's own decision over the child's", () => {
    renderTrace([delegationToolUsePart()], {
      toolApprovalStatuses: {
        "call-delegate": "denied",
        "child-chat-7": "approved",
      },
    });

    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
  });
});
