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
});
