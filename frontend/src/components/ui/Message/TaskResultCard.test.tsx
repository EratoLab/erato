import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskResultCard } from "@/components/ui/Message/TaskResultCard";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type { ContentPartTaskResult } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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

/**
 * Providers only where a failed result needs them.
 *
 * The card renders bare everywhere else — including in `MessageContent`, which
 * supplies a feature config but no query client — so the retry control is
 * mounted on the failed branch alone. These wrappers are the cost of that
 * branch, not of the card.
 */
const renderFailedCard = (
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
        <TaskResultCard part={part({ status: "failed", ...overrides })} />
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

describe("TaskResultCard", () => {
  // The retry is addressed through the chat the result was delivered into,
  // which is the chat this card is read in.
  beforeEach(() => {
    useGenerationStatusStore.getState().setCurrentChatId("origin-1");
  });
  afterEach(() => {
    useGenerationStatusStore.getState().reset();
  });

  it("shows the answer and a way into the run that produced it", () => {
    render(<TaskResultCard part={part()} />);

    expect(screen.getByTestId("task-result-summary")).toHaveTextContent(
      "THE-CHILD-ANSWER",
    );
    expect(screen.getByTestId("task-result-open-run")).toHaveAttribute(
      "href",
      expect.stringContaining("11111111-1111-1111-1111-111111111111"),
    );
    // `completed` is the unremarkable case; the card's title already says
    // what this is, so a status line there would be noise.
    expect(screen.queryByTestId("task-result-status")).toBeNull();
  });

  it("says so when the run did not simply succeed", () => {
    renderFailedCard();

    expect(screen.getByTestId("task-result-status")).toBeInTheDocument();
    expect(screen.getByTestId("task-result-card")).toHaveAttribute(
      "data-task-result-status",
      "failed",
    );
  });

  it("offers to retry only a failed run", () => {
    // A completed result must never offer to re-run the task: the answer is
    // already here, however disappointing, and a second run would be started
    // behind the user's back.
    const { unmount } = renderFailedCard({ status: "completed" }, RETRY_ON);
    expect(screen.queryByTestId("task-result-retry")).toBeNull();
    unmount();

    renderFailedCard({}, RETRY_ON);
    expect(screen.getByTestId("task-result-retry-action")).toBeInTheDocument();
    // This card records one delivery and is never rewritten, so the copy has
    // to say the retry's answer arrives as its own result instead.
    expect(screen.getByTestId("task-result-retry")).toHaveTextContent(
      /background task/i,
    );
  });

  it("offers no retry where the deployment cannot run an async task", () => {
    renderFailedCard();
    expect(screen.queryByTestId("task-result-retry")).toBeNull();
  });

  // The reason vocabulary is shared with the trace step so the two cannot
  // drift; an unknown value must degrade to something readable rather than
  // to silence.
  it("renders a known reason in words and an unknown one verbatim", () => {
    const { rerender } = render(
      <TaskResultCard part={part({ reason: "cap_exceeded" })} />,
    );
    expect(screen.getByTestId("task-result-reason")).toHaveTextContent(
      /budget/i,
    );

    rerender(<TaskResultCard part={part({ reason: "from_a_newer_server" })} />);
    expect(screen.getByTestId("task-result-reason")).toHaveTextContent(
      "from_a_newer_server",
    );
  });

  it("badges a redelivery but not the first delivery", () => {
    const { rerender } = render(
      <TaskResultCard part={part({ redeliveries: 0 })} />,
    );
    expect(screen.queryByTestId("task-result-sequence")).toBeNull();

    rerender(<TaskResultCard part={part({ redeliveries: 1 })} />);
    expect(screen.getByTestId("task-result-sequence")).toBeInTheDocument();

    // Results delivered before the field existed carry no count, only the
    // `sequence` that meant "again" back when nothing else could raise it.
    rerender(
      <TaskResultCard part={part({ sequence: 0, redeliveries: undefined })} />,
    );
    expect(screen.queryByTestId("task-result-sequence")).toBeNull();

    rerender(
      <TaskResultCard part={part({ sequence: 1, redeliveries: undefined })} />,
    );
    expect(screen.getByTestId("task-result-sequence")).toBeInTheDocument();
  });

  // A parked run's answer arrives at `sequence: 1` on every happy path, and it
  // is the result the reader has been waiting for — not the notification they
  // already saw.
  it("does not badge a parked run's follow-up answer as a redelivery", () => {
    render(
      <TaskResultCard
        part={part({ status: "completed", sequence: 1, redeliveries: 0 })}
      />,
    );

    expect(screen.queryByTestId("task-result-sequence")).toBeNull();
  });

  it("sends a task that stopped to ask to the chat where it can be answered", () => {
    render(
      <TaskResultCard
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

  it("notes a shortened answer only when it was shortened", () => {
    const { rerender } = render(
      <TaskResultCard part={part({ truncated: false })} />,
    );
    expect(screen.queryByTestId("task-result-truncated")).toBeNull();

    rerender(<TaskResultCard part={part({ truncated: true })} />);
    expect(screen.getByTestId("task-result-truncated")).toBeInTheDocument();
  });

  // The summary is a delegated run's own text, shaped by whatever it read.
  // Rendering it as markdown would let it draw links and headings in the
  // transcript; it stays plain text, as the trace's result preview does.
  it("renders the answer as plain text, not as markdown", () => {
    render(
      <TaskResultCard
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
});
