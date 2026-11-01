import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConversationMessagesProvider } from "@/components/ui/Message/ConversationMessages";
import { TaskResultStep } from "@/components/ui/Trace/steps/TaskResultStep";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { publishLocalTaskViews } from "@/lib/desktopSidecar/localTaskViewsStore";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type { ContentPartTaskResult } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { ReactElement } from "react";

const part = (
  overrides: Partial<ContentPartTaskResult> = {},
): ContentPartTaskResult => ({
  child_chat_id: "11111111-1111-1111-1111-111111111111",
  parent_tool_call_id: "call-1",
  status: "completed",
  summary: "THE-CHILD-ANSWER",
  truncated: false,
  sequence: 0,
  redeliveries: 0,
  ...overrides,
});

// Only the failed branch mounts the retry control, which needs both providers.
const renderFailedStep = (
  overrides: Partial<ContentPartTaskResult> = {},
  config: Parameters<typeof StaticFeatureConfigProvider>[0]["config"] = {},
) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StaticFeatureConfigProvider config={config}>
        <TaskResultStep part={part({ status: "failed", ...overrides })} />
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );

const RETRY_ON: Parameters<typeof StaticFeatureConfigProvider>[0]["config"] = {
  assistants: {
    enabled: true,
    delegationEnabled: true,
    delegationTasksAllowAsync: true,
  },
};

describe("TaskResultStep", () => {
  beforeEach(() => {
    useGenerationStatusStore.getState().setCurrentChatId("origin-1");
  });
  afterEach(() => {
    useGenerationStatusStore.getState().reset();
  });

  it("shows the answer and a way into the run that produced it", () => {
    render(<TaskResultStep part={part()} />);

    expect(screen.getByTestId("task-result-summary")).toHaveTextContent(
      "THE-CHILD-ANSWER",
    );
    expect(screen.getByTestId("task-result-open-run")).toHaveAttribute(
      "href",
      expect.stringContaining("11111111-1111-1111-1111-111111111111"),
    );
    expect(screen.queryByTestId("task-result-status")).toBeNull();
  });

  it("says so when the run did not simply succeed", () => {
    renderFailedStep();

    expect(screen.getByTestId("task-result-status")).toBeInTheDocument();
    expect(screen.getByTestId("task-result-step")).toHaveAttribute(
      "data-task-result-status",
      "failed",
    );
  });

  it("offers to retry only a failed run", () => {
    const { unmount } = renderFailedStep({ status: "completed" }, RETRY_ON);
    expect(screen.queryByTestId("task-result-retry")).toBeNull();
    unmount();

    renderFailedStep({}, RETRY_ON);
    expect(screen.getByTestId("task-result-retry-action")).toBeInTheDocument();
    expect(screen.getByTestId("task-result-retry")).toHaveTextContent(
      /background task/i,
    );
  });

  it("offers no retry where the deployment cannot run an async task", () => {
    renderFailedStep();
    expect(screen.queryByTestId("task-result-retry")).toBeNull();
  });

  it("renders a known reason in words and an unknown one verbatim", () => {
    const { rerender } = render(
      <TaskResultStep part={part({ reason: "cap_exceeded" })} />,
    );
    expect(screen.getByTestId("task-result-reason")).toHaveTextContent(
      /budget/i,
    );

    rerender(<TaskResultStep part={part({ reason: "from_a_newer_server" })} />);
    expect(screen.getByTestId("task-result-reason")).toHaveTextContent(
      "from_a_newer_server",
    );
  });

  it("badges a redelivery but not the first delivery", () => {
    const { rerender } = render(
      <TaskResultStep part={part({ redeliveries: 0 })} />,
    );
    expect(screen.queryByTestId("task-result-sequence")).toBeNull();

    rerender(<TaskResultStep part={part({ redeliveries: 1 })} />);
    expect(screen.getByTestId("task-result-sequence")).toBeInTheDocument();

    rerender(
      <TaskResultStep part={part({ sequence: 0, redeliveries: undefined })} />,
    );
    expect(screen.queryByTestId("task-result-sequence")).toBeNull();

    rerender(
      <TaskResultStep part={part({ sequence: 1, redeliveries: undefined })} />,
    );
    expect(screen.getByTestId("task-result-sequence")).toBeInTheDocument();
  });

  it("does not badge a parked run's follow-up answer as a redelivery", () => {
    render(
      <TaskResultStep
        part={part({ status: "completed", sequence: 1, redeliveries: 0 })}
      />,
    );

    expect(screen.queryByTestId("task-result-sequence")).toBeNull();
  });

  it("sends a task that stopped to ask to the chat where it can be answered", () => {
    render(
      <TaskResultStep
        part={part({ status: "input_required", reason: "approval_pending" })}
      />,
    );

    expect(screen.getByTestId("task-result-status")).toHaveTextContent(
      /decision/i,
    );
    expect(
      screen.getByTestId("task-result-input-required-open"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("11111111-1111-1111-1111-111111111111"),
    );
  });

  it("names the model the task ran on, and a fallback", () => {
    const { rerender } = render(
      <TaskResultStep
        part={part({
          model: { chat_provider_id: "model-b", display_name: "Model B" },
        })}
      />,
    );
    expect(screen.getByTestId("task-result-model")).toHaveTextContent(
      "Model: Model B",
    );
    expect(screen.queryByTestId("task-result-model-unavailable")).toBeNull();

    rerender(
      <TaskResultStep
        part={part({
          model: {
            chat_provider_id: "mock-llm",
            unavailable_chat_provider_id: "model-x",
            note: "for the origin model only",
          },
        })}
      />,
    );
    expect(screen.getByTestId("task-result-model")).toHaveTextContent(
      "Model: mock-llm",
    );
    expect(
      screen.getByTestId("task-result-model-unavailable"),
    ).toHaveTextContent("not available to you, so it ran on mock-llm.");
    expect(screen.getByTestId("task-result-step")).not.toHaveTextContent(
      "for the origin model only",
    );
  });

  it("shows no model on a result delivered before the model was recorded", () => {
    render(<TaskResultStep part={part()} />);
    expect(screen.queryByTestId("task-result-model")).toBeNull();
  });

  it("notes a shortened answer only when it was shortened", () => {
    const { rerender } = render(
      <TaskResultStep part={part({ truncated: false })} />,
    );
    expect(screen.queryByTestId("task-result-truncated")).toBeNull();

    rerender(<TaskResultStep part={part({ truncated: true })} />);
    expect(screen.getByTestId("task-result-truncated")).toBeInTheDocument();
  });

  it("renders the answer as plain text, not as markdown", () => {
    render(
      <TaskResultStep
        part={part({ summary: "[click me](https://example.com) **bold**" })}
      />,
    );

    const summary = screen.getByTestId("task-result-summary");
    expect(summary).toHaveTextContent(
      "[click me](https://example.com) **bold**",
    );
    expect(summary.querySelector("a")).toBeNull();
    expect(summary.querySelector("strong")).toBeNull();
  });

  it("quotes the answer when a reply restates it, and shows it whole otherwise", () => {
    const long = "x".repeat(400);
    const { rerender } = render(
      <TaskResultStep part={part({ summary: long })} hasReply />,
    );
    expect(screen.getByTestId("task-result-summary").textContent).toHaveLength(
      281,
    );

    rerender(<TaskResultStep part={part({ summary: long })} />);
    expect(screen.getByTestId("task-result-summary")).toHaveTextContent(long);
  });

  it("starts collapsed only for a completed result a reply restates", () => {
    const expanded = (ui: ReactElement) => {
      const { unmount } = render(ui);
      const value = screen
        .getByRole("button", { name: /task reported back/i })
        .getAttribute("aria-expanded");
      unmount();
      return value;
    };

    expect(expanded(<TaskResultStep part={part()} hasReply />)).toBe("false");
    expect(expanded(<TaskResultStep part={part()} />)).toBe("true");
    expect(
      expanded(
        <TaskResultStep
          part={part({ status: "input_required", reason: "approval_pending" })}
          hasReply
        />,
      ),
    ).toBe("true");
  });

  describe("a local-evidence task waiting for its review", () => {
    const waiting = part({
      status: "input_required",
      reason: "client_pending",
      summary: "",
    });
    afterEach(() => publishLocalTaskViews([]));

    it("shows the state this device knows of the job", () => {
      publishLocalTaskViews([
        {
          id: "job",
          chatId: waiting.child_chat_id,
          messageId: "task-message",
          state: "ready_for_review",
        },
      ]);
      render(<TaskResultStep part={waiting} />);
      const pill = screen.getByTestId("task-result-status");
      expect(pill).toHaveTextContent("Ready for review in the desktop app");
      expect(pill.firstElementChild).toHaveClass("bg-theme-warning-bg");
      expect(
        screen.getByTestId("task-result-input-required"),
      ).toHaveTextContent("Follow it in the task's own chat:");
    });

    it("says only where the review happens on a device that does not know the job", () => {
      publishLocalTaskViews([
        {
          id: "other",
          chatId: "another-task",
          messageId: "m",
          state: "ready_for_review",
        },
      ]);
      render(<TaskResultStep part={waiting} />);
      const card = screen.getByTestId("task-result-step");
      expect(screen.getByTestId("task-result-status")).toHaveTextContent(
        "Review in the Erato desktop app",
      );
      expect(card).not.toHaveTextContent(/waiting/i);
      expect(
        screen.getByTestId("task-result-status").firstElementChild,
      ).not.toHaveClass("bg-theme-warning-bg");
      expect(card).not.toHaveTextContent("Needs your decision");
      expect(card).not.toHaveTextContent("on this device");
      expect(
        screen.queryByTestId("task-result-reason"),
      ).not.toBeInTheDocument();
    });

    // The device forgets a job once it is acknowledged, so after the task
    // reported again only that later report says how it ended.
    describe("once a later report of the same task is in the chat", () => {
      const row = (id: string, result: ContentPartTaskResult): Message => ({
        id,
        role: "user",
        createdAt: "2026-11-01T00:00:00Z",
        content: [{ content_type: "task_result", ...result }],
      });
      const finished = row(
        "later",
        part({ status: "completed", sequence: 1, summary: "found it" }),
      );
      const renderBeside = (
        others: Message[],
        ui: ReactElement = <TaskResultStep part={waiting} />,
      ) =>
        render(
          <ConversationMessagesProvider
            messages={Object.fromEntries(
              [row("earlier", waiting), ...others].map((message) => [
                message.id,
                message,
              ]),
            )}
          >
            {ui}
          </ConversationMessagesProvider>,
        );

      it("shows the earlier line as replaced, not waiting", () => {
        renderBeside([finished], <TaskResultStep part={waiting} hasReply />);

        const card = screen.getByTestId("task-result-step");
        expect(screen.getByTestId("task-result-status")).toHaveTextContent(
          "Replaced by a later report",
        );
        expect(card).not.toHaveTextContent(/waiting|review/i);
        expect(screen.queryByTestId("task-result-input-required")).toBeNull();
        expect(
          screen
            .getByRole("button", { name: /task reported back/i })
            .getAttribute("aria-expanded"),
        ).toBe("false");
      });

      it("keeps the state this device still knows of the job", () => {
        publishLocalTaskViews([
          {
            id: "job",
            chatId: waiting.child_chat_id,
            messageId: "task-message",
            state: "continuing",
          },
        ]);
        renderBeside([finished]);

        expect(screen.getByTestId("task-result-status")).toHaveTextContent(
          "Continuing the original task",
        );
      });

      it("counts only a later delivery of the same task", () => {
        renderBeside([
          row(
            "other-task",
            part({ child_chat_id: "another-task", sequence: 1 }),
          ),
          row("same-delivery", part({ sequence: 0 })),
        ]);

        expect(screen.getByTestId("task-result-status")).toHaveTextContent(
          "Review in the Erato desktop app",
        );
      });
    });

    it("keeps the decision wording for a task that waits on a question", () => {
      publishLocalTaskViews([
        {
          id: "job",
          chatId: waiting.child_chat_id,
          messageId: "m",
          state: "ready_for_review",
        },
      ]);
      render(
        <TaskResultStep
          part={part({ status: "input_required", reason: "approval_pending" })}
        />,
      );
      expect(screen.getByTestId("task-result-status")).toHaveTextContent(
        "Needs your decision",
      );
      expect(
        screen.getByTestId("task-result-input-required"),
      ).toHaveTextContent("Answer it in the task's own chat:");
    });
  });
});
