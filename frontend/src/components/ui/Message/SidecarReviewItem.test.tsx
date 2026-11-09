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
function ItemFor() {
  const link = useSidecarReviewLinks((state) => state.links[key]) as
    | SidecarReviewLink
    | undefined;
  return link ? (
    <SidecarReviewItem
      linkKey={key}
      link={link}
      toolName="search_sidecar_index"
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

  it("offers no action the app cannot take while it is not running", () => {
    supports.mockReturnValue(false);
    rememberReview(key, "handle-1");
    const { unmount } = render(<ItemFor />);
    expect(screen.getByTestId("sidecar-review-open")).toBeDisabled();
    unmount();
    markReviewEnded(key);
    render(<ItemFor />);
    expect(screen.getByTestId("sidecar-review-ask-again")).toBeDisabled();
  });
});
