import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionConfirmationCard } from "./ActionConfirmationCard";

vi.mock("../Controls/Button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

describe("ActionConfirmationCard", () => {
  it("renders title, description, and both actions while pending", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ActionConfirmationCard
        title="Reply to all recipients?"
        description="Alice, Bob"
        confirmLabel="Open Reply All"
        dismissLabel="Not now"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Reply to all recipients?")).toBeInTheDocument();
    expect(screen.getByText("Alice, Bob")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Reply All"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Not now"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders rich description nodes as-is", () => {
    render(
      <ActionConfirmationCard
        title="t"
        description={<ul data-testid="recipients" />}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("recipients")).toBeInTheDocument();
  });

  it("disables both buttons while busy", () => {
    render(
      <ActionConfirmationCard
        title="t"
        confirmLabel="Go"
        dismissLabel="No"
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
        isBusy
      />,
    );
    expect(screen.getByText("Go")).toBeDisabled();
    expect(screen.getByText("No")).toBeDisabled();
  });

  it("renders a compact resolved row instead of buttons once resolved", () => {
    render(
      <ActionConfirmationCard
        title="t"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
        status="confirmed"
        resolvedLabel="Reply opened"
      />,
    );
    expect(screen.getByText("Reply opened")).toBeInTheDocument();
    expect(screen.queryByText("Go")).not.toBeInTheDocument();
  });

  it("scrolls into view on mount only when requested", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { unmount } = render(
      <ActionConfirmationCard
        title="t"
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    unmount();
    render(
      <ActionConfirmationCard
        title="t"
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
        scrollIntoViewOnMount
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
