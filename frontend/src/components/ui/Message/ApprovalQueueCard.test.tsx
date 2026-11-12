import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  askForReviewAgain,
  markReviewEnded,
  markTaskReviewEnded,
  rememberReview,
  reviewLinkKey,
  useSidecarReviewLinks,
} from "@/lib/desktopSidecar/sidecarReviewLinks";

import { ApprovalQueueCard } from "./ApprovalQueueCard";

import type { ApprovalItemPart } from "./approvalItems";

const invoke = vi.fn();
const supports = vi.fn(() => true);

vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({ client: { invoke, supports } }),
}));

/** A task child of this response that waits for its call on the device. */
const waitingTask = (id: string, task: string): ApprovalItemPart => ({
  approval_id: id,
  tool_call_id: id,
  tool_name: "delegate_task",
  input: { task },
  child: {
    child_chat_id: `chat-${id}`,
    child_message_id: `message-${id}`,
    child_tool_call_id: `call-${id}`,
    tool_name: "search_sidecar_index",
    mcp_server_id: "desktop",
    input: { query: "report" },
    annotations,
    preset: "",
    requested_at: "2026-11-10T00:00:00Z",
    kind: "client_tool",
    waiting_for: { host_context: "desktop_sidecar", attempt_id: "attempt" },
  },
});

const annotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
};
const reviewed = waitingTask("one", "Find the report");
const other = waitingTask("two", "Check the calendar");
const reviewKey = reviewLinkKey("message-one", "call-one");

const renderCard = (
  waiting: ApprovalItemPart[],
  { awaitsOwnCall = false }: { awaitsOwnCall?: boolean } = {},
) =>
  render(
    <ApprovalQueueCard
      request={{
        kind: "delegated_task",
        requested_at: "2026-11-10T00:00:00Z",
        allow_always: false,
        mcp_server_id: "",
        annotations,
      }}
      items={[]}
      waiting={waiting}
      awaitsOwnCall={awaitsOwnCall}
      staged={{}}
      isArchived={false}
      isBusy={false}
      onDecideItem={vi.fn()}
      onDecideAll={vi.fn()}
    />,
  );

describe("a task's review in the slot of the response it runs for", () => {
  beforeEach(() => {
    invoke.mockReset();
    supports.mockReturnValue(true);
  });
  afterEach(() => {
    localStorage.clear();
    useSidecarReviewLinks.setState({ links: {} });
  });

  it("shows the review on the task's item, naming the task, and says the task waits for the user", () => {
    rememberReview(reviewKey, "handle-1", ["chat-one", "parent-chat"]);
    renderCard([reviewed]);

    const item = screen.getByTestId("waiting-task-item");
    expect(item).toHaveTextContent("Find the report");
    const review = screen.getByTestId("sidecar-review-item");
    expect(item).toContainElement(review);
    expect(review).toHaveAttribute("data-review-state", "open");
    expect(review).toHaveTextContent(
      "Waiting for your review in the Erato desktop app",
    );
    expect(review).toHaveTextContent("A review ends one hour after it starts.");
    expect(item).not.toHaveTextContent("Waiting for the Erato desktop app");
    expect(screen.getByTestId("waiting-task-open")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A task waits for your review in the Erato desktop app. The response continues once the task finishes.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/continues on its own/)).toBeNull();
  });

  it("brings the task's review window to the front on Open", async () => {
    rememberReview(reviewKey, "handle-1", ["chat-one", "parent-chat"]);
    invoke.mockResolvedValue({ handle: "handle-1", state: "ready_for_review" });
    renderCard([reviewed]);

    fireEvent.click(screen.getByTestId("sidecar-review-open"));
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0][0]).toBe("jobs.review.v1");
    expect(invoke.mock.calls[0][1]).toMatchObject({ handle: "handle-1" });
  });

  it("says the task's review ended, with nothing to ask again, and that the response goes on", () => {
    rememberReview(reviewKey, "handle-1", ["chat-one", "parent-chat"]);
    markTaskReviewEnded(reviewKey);
    renderCard([reviewed]);

    const review = screen.getByTestId("sidecar-review-item");
    expect(review).toHaveAttribute("data-review-state", "ended");
    expect(review).toHaveTextContent("This review has ended");
    expect(review).toHaveTextContent(
      "Nothing was shared. The task goes on without this result.",
    );
    expect(screen.queryByTestId("sidecar-review-ask-again")).toBeNull();
    expect(screen.queryByTestId("sidecar-review-open")).toBeNull();
    expect(
      screen.getByText("It continues on its own once the task finishes."),
    ).toBeInTheDocument();
  });

  it("keeps the ended item while the app still holds the chats on it", () => {
    rememberReview(reviewKey, "handle-1", ["chat-one", "parent-chat"]);
    markReviewEnded(reviewKey);
    renderCard([reviewed]);

    expect(screen.getByTestId("sidecar-review-item")).toHaveTextContent(
      "This review has ended",
    );
    expect(screen.queryByTestId("sidecar-review-ask-again")).toBeNull();
  });

  it("leaves a task with no review, and one whose user asked again, as a plain waiting item", () => {
    rememberReview(reviewKey, "handle-1", ["chat-one", "parent-chat"]);
    const asked = waitingTask("three", "Read the thread");
    askForReviewAgain(reviewLinkKey("message-three", "call-three"));
    renderCard([reviewed, other, asked]);

    const items = screen.getAllByTestId("waiting-task-item");
    expect(items).toHaveLength(3);
    for (const plain of items.slice(1))
      expect(plain).toHaveTextContent(
        "Waiting for the Erato desktop app on this device",
      );
    expect(screen.getAllByTestId("sidecar-review-item")).toHaveLength(1);
    expect(
      screen.getByText(
        "A task waits for your review in the Erato desktop app. The response continues once the tasks finish.",
      ),
    ).toBeInTheDocument();
  });

  it("names the connected app when the response waits for its own call too", () => {
    rememberReview(reviewKey, "handle-1", ["chat-one", "parent-chat"]);
    rememberReview(reviewLinkKey("message-two", "call-two"), "handle-2", [
      "chat-two",
      "parent-chat",
    ]);
    renderCard([reviewed, other], { awaitsOwnCall: true });

    expect(screen.getAllByTestId("sidecar-review-item")).toHaveLength(2);
    expect(
      screen.getByText(
        "2 tasks wait for your review in the Erato desktop app. The response continues once the tasks and the connected app have finished.",
      ),
    ).toBeInTheDocument();
  });

  it("is unchanged while no review is open", () => {
    renderCard([reviewed]);

    expect(screen.getByTestId("waiting-task-item")).toHaveTextContent(
      "Waiting for the Erato desktop app on this device",
    );
    expect(screen.queryByTestId("sidecar-review-item")).toBeNull();
    expect(
      screen.getByText("It continues on its own once the task finishes."),
    ).toBeInTheDocument();
  });
});
