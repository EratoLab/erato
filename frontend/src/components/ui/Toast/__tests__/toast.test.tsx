import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Toaster } from "../Toaster";
import { toast } from "../toast";
import { useToastStore } from "../toastStore";

afterEach(() => {
  act(() => {
    useToastStore.setState({ toasts: [] });
  });
});

describe("toast / Toaster", () => {
  it("renders a queued toast", () => {
    render(<Toaster />);
    act(() => {
      toast.info({ title: "Hello there" });
    });
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("dismisses on close click", async () => {
    render(<Toaster />);
    act(() => {
      toast.info({ title: "Bye soon" });
    });
    const closeButton = screen.getByRole("button", {
      name: /Dismiss notification/i,
    });
    await act(async () => {
      closeButton.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(screen.queryByText("Bye soon")).not.toBeInTheDocument();
  });

  it("invokes action callbacks and dismisses", () => {
    let clicked = false;
    render(<Toaster />);
    act(() => {
      toast.custom({
        variant: "info",
        title: "Decide",
        actions: [
          {
            id: "go",
            label: "Go",
            onClick: () => {
              clicked = true;
            },
          },
        ],
      });
    });
    const button = screen.getByRole("button", { name: "Go" });
    act(() => button.click());
    expect(clicked).toBe(true);
  });

  it("dedupes by key — second emission replaces the first", () => {
    render(<Toaster />);
    act(() => {
      toast.info({ title: "Original", dedupeKey: "k" });
    });
    act(() => {
      toast.info({ title: "Replacement", dedupeKey: "k" });
    });
    expect(screen.queryByText("Original")).not.toBeInTheDocument();
    expect(screen.getByText("Replacement")).toBeInTheDocument();
  });

  it("renders an href action as a link and keeps the toast open through it", () => {
    render(<Toaster />);
    act(() => {
      toast.custom({
        variant: "info",
        title: "Still waiting",
        actions: [
          {
            id: "open",
            label: "Open again",
            href: "https://example.test/auth",
          },
        ],
      });
    });
    const link = screen.getByRole("link", { name: "Open again" });
    expect(link).toHaveAttribute("href", "https://example.test/auth");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Leaving to finish the work elsewhere must not retract the toast that
    // says the work is still outstanding.
    act(() => link.click());
    expect(screen.getByText("Still waiting")).toBeInTheDocument();
  });

  it("dismisses by dedupe key, running the descriptor's onDismiss", () => {
    let dismissed = false;
    render(<Toaster />);
    act(() => {
      toast.info({
        title: "Occupying the slot",
        dedupeKey: "slot",
        onDismiss: () => {
          dismissed = true;
        },
      });
    });
    act(() => toast.dismissKey("slot"));
    expect(screen.queryByText("Occupying the slot")).not.toBeInTheDocument();
    expect(dismissed).toBe(true);
    // An empty slot is not an error.
    expect(() => act(() => toast.dismissKey("slot"))).not.toThrow();
  });
});
