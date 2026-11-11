import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CheckCircleIcon,
  HourglassIcon,
  ToolsIcon,
} from "@/components/ui/icons";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { messages as enMessages } from "@/locales/en/messages.json";

import { groupIntoTraceClusters, Trace } from "./Trace";
import { railIconFor } from "./icons";

import type { ToolDecision } from "./Trace";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";
import type { ReactElement } from "react";

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

const ALLOWED_ONCE: ToolDecision = { status: "approved", alwaysAllow: false };
const DENIED_ONCE: ToolDecision = {
  status: "denied",
  neverAllow: false,
  withdrawn: false,
};

const renderTrace = (
  parts: ContentPart[],
  overrides: {
    maskReasoningText?: boolean;
    isStreaming?: boolean;
    toolDecisions?: Record<string, ToolDecision>;
    waitingCall?: {
      toolCallId: string;
      review?: "open" | "asking" | "ended";
    };
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
          isStreaming={overrides.isStreaming ?? false}
          hasLaterContent={false}
          renderMarkdown={(text) => <span>{text}</span>}
          durationMs={null}
          toolDecisions={overrides.toolDecisions}
          waitingCall={overrides.waitingCall}
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

describe("Trace — a call the turn is parked on", () => {
  const CHAT = "chat-under-test";
  const WAITING = { toolCallId: "tool-abc" };
  const parkOnPage = (kind: "action_required" | "finished") =>
    useGenerationStatusStore.setState({
      currentChatId: CHAT,
      statusByChatId: {
        [CHAT]:
          kind === "finished"
            ? { kind, startedAt: new Date().toISOString() }
            : {
                kind,
                startedAt: new Date().toISOString(),
                localSeenAt: Date.now(),
              },
      },
    });

  beforeEach(() => {
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
  });

  it("says the call waits for a connected app, not Done, while the chat reads parked", () => {
    parkOnPage("action_required");
    renderTrace([toolUsePart("in_progress")], { waitingCall: WAITING });

    expect(
      screen.getByText("Waiting for a connected app on this device"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Interrupted")).toBeNull();
    // A trace whose call has not returned has not ended.
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("says the call waits, not Interrupted, when the page reads the chat as ended", () => {
    parkOnPage("finished");
    renderTrace([toolUsePart("in_progress")], { waitingCall: WAITING });

    expect(
      screen.getByText("Waiting for a connected app on this device"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Interrupted")).toBeNull();
  });

  it.each(["open", "asking"] as const)(
    "names the review in the Erato desktop app while it is %s",
    (review) => {
      renderTrace([toolUsePart("in_progress")], {
        waitingCall: { ...WAITING, review },
      });

      expect(
        screen.getByText("Review in the Erato desktop app"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Waiting for a connected app on this device"),
      ).toBeNull();
    },
  );

  it("says the review ended, not that it waits for one or for an app", () => {
    renderTrace([toolUsePart("in_progress")], {
      waitingCall: { ...WAITING, review: "ended" },
    });

    expect(screen.getByText("This review has ended")).toBeInTheDocument();
    expect(screen.queryByText("Review in the Erato desktop app")).toBeNull();
    expect(
      screen.queryByText("Waiting for a connected app on this device"),
    ).toBeNull();
    expect(screen.queryByText("Interrupted")).toBeNull();
  });

  it("ends on done once the call returned, with the trace Done again", () => {
    renderTrace([toolUsePart("success")], { waitingCall: WAITING });

    expect(
      screen.queryByText("Waiting for a connected app on this device"),
    ).toBeNull();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("keeps Interrupted for an unfinished call the turn does not wait on", () => {
    renderTrace([toolUsePart("in_progress")], {
      waitingCall: { toolCallId: "another-call", review: "open" },
    });

    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(screen.queryByText("Review in the Erato desktop app")).toBeNull();
  });

  it("draws the hourglass on the rail, never the check", () => {
    const icon = railIconFor("tool_use", "waiting") as ReactElement;
    expect(icon.type).toBe(HourglassIcon);
    expect(icon.type).not.toBe(CheckCircleIcon);
    expect(icon.type).not.toBe(ToolsIcon);
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

  it("shows an approved call that failed as failed, with the approval on its own row", () => {
    renderTrace([toolUsePart("error")], {
      toolDecisions: { "tool-abc": ALLOWED_ONCE },
    });

    expect(screen.getByTestId("tool-decision-row")).toHaveTextContent(
      "You allowed this once",
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
  });

  it("shows a rejected call's denial, not Failed", () => {
    renderTrace([toolUsePart("error")], {
      toolDecisions: { "tool-abc": DENIED_ONCE },
    });

    expect(screen.getByTestId("tool-decision-row")).toHaveTextContent(
      "You denied this",
    );
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("puts a decision recorded on the child's chat beside the step that dispatched it", () => {
    // A delegated decision names the child it was taken for, which is the only
    // id shared with the slot once the parent's call id has been rewritten.
    renderTrace([delegationToolUsePart()], {
      toolDecisions: { "child-chat-7": ALLOWED_ONCE },
    });

    expect(screen.getByTestId("tool-decision-row")).toHaveTextContent(
      "You allowed this once",
    );
  });

  it("prefers the call's own decision over the child's", () => {
    renderTrace([delegationToolUsePart()], {
      toolDecisions: {
        "call-delegate": DENIED_ONCE,
        "child-chat-7": ALLOWED_ONCE,
      },
    });

    expect(screen.getByTestId("tool-decision-row")).toHaveTextContent(
      "You denied this",
    );
    expect(screen.queryByText("You allowed this once")).not.toBeInTheDocument();
  });

  it.each(["status", "neverAllow"])(
    "reads only a decision recorded under the call's own id %s",
    (id) => {
      const decisions: Record<string, ToolDecision> = {};
      // How a plain map takes a decision recorded under the id `__proto__`.
      decisions["__proto__"] = DENIED_ONCE;
      renderTrace(
        [
          {
            ...toolUsePart("error"),
            tool_call_id: id,
            output: { status: "rejected" },
          } as unknown as ContentPart,
        ],
        { toolDecisions: decisions },
      );

      expect(screen.getByTestId("tool-decision-row")).toHaveTextContent(
        /^Not run$/,
      );
      expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    },
  );
});

const budgetRequest = (): ContentPart =>
  ({
    content_type: "tool_approval_request",
    kind: "tool_call_limit",
    tool_call_id: "tool-budget:1",
    tool_name: "Tool-call budget",
    input: { budget: 25 },
    mcp_server_id: "",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    preset: "",
    allow_always: false,
    requested_at: "2026-10-02T14:48:00Z",
    approvals: [],
    pending_tool_calls: [],
  }) as unknown as ContentPart;

const budgetDecision = (approved: boolean): ContentPart =>
  approved
    ? {
        content_type: "tool_approval",
        tool_call_id: "tool-budget:1",
        approved_at: "2026-10-02T14:49:00Z",
        always_allow: false,
      }
    : {
        content_type: "tool_rejection",
        tool_call_id: "tool-budget:1",
        rejected_at: "2026-10-02T14:49:00Z",
      };

describe("tool budget approvals", () => {
  it.each([
    { approved: true, isStreaming: false },
    { approved: false, isStreaming: false },
    { approved: true, isStreaming: true },
    { approved: false, isStreaming: true },
  ])(
    "keeps the settled budget request and tool chain in one trace ($approved, streaming: $isStreaming)",
    ({ approved, isStreaming }) => {
      const parts = [
        toolUsePart(),
        budgetRequest(),
        budgetDecision(approved),
        reasoningPart("Continuing"),
      ];
      expect(groupIntoTraceClusters(parts)).toEqual([
        { kind: "trace", parts, startIndex: 0 },
      ]);
      renderTrace(parts, { isStreaming });
      expect(screen.getByText("Tool-call budget")).toBeInTheDocument();
      expect(
        screen.getByText(approved ? "Approved" : "Denied"),
      ).toBeInTheDocument();
    },
  );

  it("leaves pending budget requests available to the approval-card renderer", () => {
    const request = budgetRequest();
    expect(groupIntoTraceClusters([toolUsePart(), request])).toEqual([
      { kind: "trace", parts: [toolUsePart()], startIndex: 0 },
      { kind: "passthrough", part: request, index: 1 },
    ]);
  });

  it("does not let an earlier decision settle a later request", () => {
    const request = budgetRequest();
    const clusters = groupIntoTraceClusters([
      budgetDecision(true),
      toolUsePart(),
      request,
    ]);
    expect(clusters.at(-1)).toEqual({
      kind: "passthrough",
      part: request,
      index: 2,
    });
  });

  it("preserves text boundaries and source indices after a budget decision", () => {
    const parts = [toolUsePart(), budgetRequest(), budgetDecision(true)];
    const text: ContentPart = { content_type: "text", text: "Answer" };
    expect(
      groupIntoTraceClusters([...parts, text, reasoningPart("More")]),
    ).toEqual([
      { kind: "trace", parts, startIndex: 0 },
      { kind: "passthrough", part: text, index: 3 },
      { kind: "trace", parts: [reasoningPart("More")], startIndex: 4 },
    ]);
  });
});
