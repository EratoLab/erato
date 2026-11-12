import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientOperationHandlerRegistry } from "@/lib/clientOperations/handlers";
import {
  markReviewEnded,
  markTaskReviewEnded,
  rememberReview,
  reviewLink,
  reviewLinkKey,
  useSidecarReviewLinks,
} from "@/lib/desktopSidecar/sidecarReviewLinks";

import { SidecarReviewItem } from "./SidecarReviewItem";

import type { SidecarReviewLink } from "@/lib/desktopSidecar/sidecarReviewLinks";

const invoke = vi.fn();
const supports = vi.fn(() => true);

vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({ client: { invoke, supports } }),
}));

const key = reviewLinkKey("message-1", "call");

/** Renders the item for the call's link as the store holds it now. */
function ItemFor({ inTaskItem }: { inTaskItem?: boolean }) {
  const link = useSidecarReviewLinks((state) => state.links[key]) as
    | SidecarReviewLink
    | undefined;
  return link ? (
    <SidecarReviewItem
      linkKey={key}
      link={link}
      toolName="search_sidecar_index"
      inTaskItem={inTaskItem}
    />
  ) : null;
}

describe("SidecarReviewItem", () => {
  beforeEach(() => {
    invoke.mockReset();
    supports.mockReturnValue(true);
  });
  afterEach(() => {
    localStorage.clear();
    useSidecarReviewLinks.setState({ links: {} });
  });

  it("asks the app to show the same job's review again, however often it is pressed", async () => {
    rememberReview(key, "handle-1");
    invoke.mockResolvedValue({ handle: "handle-1", state: "ready_for_review" });
    render(<ItemFor />);
    const open = screen.getByTestId("sidecar-review-open");
    fireEvent.click(open);
    fireEvent.click(open);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    for (const call of invoke.mock.calls) {
      expect(call[0]).toBe("jobs.review.v1");
      expect(call[1]).toMatchObject({ handle: "handle-1" });
    }
    expect(screen.getByTestId("sidecar-review-item")).toHaveAttribute(
      "data-review-state",
      "open",
    );
  });

  it("turns into the ended item when the app no longer has the review", async () => {
    rememberReview(key, "handle-1");
    invoke.mockResolvedValue({ handle: "handle-1", state: "expired" });
    render(<ItemFor />);
    fireEvent.click(screen.getByTestId("sidecar-review-open"));
    await waitFor(() =>
      expect(screen.getByTestId("sidecar-review-item")).toHaveTextContent(
        "This review has ended",
      ),
    );
    expect(screen.getByTestId("sidecar-review-ask-again")).toBeInTheDocument();
  });

  it("shows a task's review with Open, and once it ended offers nothing to ask again", async () => {
    rememberReview(key, "handle-1", ["task-chat", "origin-chat"]);
    invoke.mockResolvedValue({ handle: "handle-1", state: "expired" });
    // Inside the task's item the call is the task's, whatever the link says.
    render(<ItemFor inTaskItem />);
    const item = screen.getByTestId("sidecar-review-item");
    expect(item).toHaveTextContent(
      "Waiting for your review in the Erato desktop app",
    );
    const open = screen.getByTestId("sidecar-review-open");
    open.focus();
    fireEvent.click(open);
    await waitFor(() =>
      expect(item).toHaveTextContent("This review has ended"),
    );
    expect(item).toHaveTextContent(
      "Nothing was shared. The task goes on without this result.",
    );
    expect(screen.queryByTestId("sidecar-review-ask-again")).toBeNull();
    // Open went away with the open review, so the item keeps the focus.
    expect(item).toHaveFocus();
  });

  it("reads a task's review from its link wherever it shows, as in the task's own chat", async () => {
    rememberReview(key, "handle-1", ["task-chat", "origin-chat"], {
      task: true,
    });
    invoke.mockResolvedValue({ handle: "handle-1", state: "expired" });
    render(<ItemFor />);
    const item = screen.getByTestId("sidecar-review-item");
    fireEvent.click(screen.getByTestId("sidecar-review-open"));
    await waitFor(() =>
      expect(item).toHaveTextContent("This review has ended"),
    );
    expect(reviewLink(key)).toMatchObject({ state: "ended", task: true });
    expect(item).toHaveTextContent(
      "Nothing was shared. The task goes on without this result.",
    );
    expect(screen.queryByTestId("sidecar-review-ask-again")).toBeNull();
    expect(screen.queryByTestId("sidecar-review-open")).toBeNull();
  });

  it("gives a task's ended review no action, so no reason, while the app cannot be reached", () => {
    supports.mockReturnValue(false);
    markTaskReviewEnded(key);
    render(<ItemFor />);
    expect(screen.getByTestId("sidecar-review-item")).toHaveTextContent(
      "The task goes on without this result.",
    );
    expect(screen.queryByTestId("sidecar-review-ask-again")).toBeNull();
    expect(
      screen.queryByText(
        "Start the Erato desktop app to continue this review.",
      ),
    ).toBeNull();
  });

  it("says so when the app cannot show the review", async () => {
    rememberReview(key, "handle-1");
    invoke.mockRejectedValue(new Error("Not running."));
    render(<ItemFor />);
    fireEvent.click(screen.getByTestId("sidecar-review-open"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not show this review",
    );
    expect(reviewLink(key)?.state).toBe("open");
  });

  it("asks again once, by asking for one new run of the call", () => {
    markReviewEnded(key);
    const sweep = vi.fn();
    const unsubscribe = clientOperationHandlerRegistry.subscribe(sweep);
    render(<ItemFor />);
    act(() => {
      fireEvent.click(screen.getByTestId("sidecar-review-ask-again"));
    });
    unsubscribe();
    expect(reviewLink(key)?.state).toBe("asking");
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sidecar-review-item")).toHaveTextContent(
      "Asking again",
    );
    expect(screen.queryByTestId("sidecar-review-ask-again")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("is a labelled group that announces its title as the review changes", async () => {
    rememberReview(key, "handle-1");
    invoke.mockResolvedValue({ handle: "handle-1", state: "expired" });
    render(<ItemFor />);
    expect(
      screen.getByRole("group", {
        name: "Waiting for your review in the Erato desktop app",
      }),
    ).toBe(screen.getByTestId("sidecar-review-item"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for your review in the Erato desktop app",
    );
    fireEvent.click(screen.getByTestId("sidecar-review-open"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "This review has ended",
      ),
    );
    expect(
      screen.getByRole("group", { name: "This review has ended" }),
    ).toBeInTheDocument();
  });

  it("keeps keyboard focus on the item when Ask again goes away", () => {
    markReviewEnded(key);
    render(<ItemFor />);
    const askAgain = screen.getByTestId("sidecar-review-ask-again");
    askAgain.focus();
    act(() => {
      fireEvent.click(askAgain);
    });
    expect(screen.queryByTestId("sidecar-review-ask-again")).toBeNull();
    expect(screen.getByTestId("sidecar-review-item")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Asking again in the Erato desktop app",
    );
  });

  it("says why its action cannot be used while the app is not running", () => {
    supports.mockReturnValue(false);
    rememberReview(key, "handle-1");
    const { unmount } = render(<ItemFor />);
    const open = screen.getByTestId("sidecar-review-open");
    // Focusable, so the reason is found with the action.
    expect(open).not.toBeDisabled();
    expect(open).toHaveAttribute("aria-disabled", "true");
    expect(open).toHaveAccessibleDescription(
      "Start the Erato desktop app to continue this review.",
    );
    fireEvent.click(open);
    expect(invoke).not.toHaveBeenCalled();
    unmount();
    markReviewEnded(key);
    render(<ItemFor />);
    const askAgain = screen.getByTestId("sidecar-review-ask-again");
    expect(askAgain).toHaveAttribute("aria-disabled", "true");
    expect(askAgain).toHaveAccessibleDescription(
      "Start the Erato desktop app to continue this review.",
    );
    fireEvent.click(askAgain);
    expect(reviewLink(key)?.state).toBe("ended");
  });

  it("gives no reason while the app can be reached", () => {
    rememberReview(key, "handle-1");
    render(<ItemFor />);
    const open = screen.getByTestId("sidecar-review-open");
    expect(open).not.toHaveAttribute("aria-disabled");
    expect(open).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByText(
        "Start the Erato desktop app to continue this review.",
      ),
    ).toBeNull();
  });
});
