import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskResultCard } from "@/components/ui/Message/TaskResultCard";

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
  ...overrides,
});

describe("TaskResultCard", () => {
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
    render(<TaskResultCard part={part({ status: "failed" })} />);

    expect(screen.getByTestId("task-result-status")).toBeInTheDocument();
    expect(screen.getByTestId("task-result-card")).toHaveAttribute(
      "data-task-result-status",
      "failed",
    );
  });

  /// The reason vocabulary is shared with the trace step so the two cannot
  /// drift; an unknown value must degrade to something readable rather than
  /// to silence.
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

  /// `sequence` is 0-based: 0 is the first delivery. Badging on `> 1` would
  /// silently hide the fact that a result was delivered a second time after
  /// the conversation branched, which is exactly when a reader needs telling.
  it("badges a redelivery but not the first delivery", () => {
    const { rerender } = render(
      <TaskResultCard part={part({ sequence: 0 })} />,
    );
    expect(screen.queryByTestId("task-result-sequence")).toBeNull();

    rerender(<TaskResultCard part={part({ sequence: 1 })} />);
    expect(screen.getByTestId("task-result-sequence")).toBeInTheDocument();
  });

  it("notes a shortened answer only when it was shortened", () => {
    const { rerender } = render(
      <TaskResultCard part={part({ truncated: false })} />,
    );
    expect(screen.queryByTestId("task-result-truncated")).toBeNull();

    rerender(<TaskResultCard part={part({ truncated: true })} />);
    expect(screen.getByTestId("task-result-truncated")).toBeInTheDocument();
  });

  /// The summary is a delegated run's own text, shaped by whatever it read.
  /// Rendering it as markdown would let it draw links and headings in the
  /// transcript; it stays plain text, as the trace's result preview does.
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
