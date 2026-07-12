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
  it("renders the generic frame with all three decisions", () => {
    const onAllowOnce = vi.fn();
    const onAlwaysAllow = vi.fn();
    const onDeny = vi.fn();
    render(
      <ActionConfirmationCard
        description="Open a reply to all recipients: Alice, Bob"
        onAllowOnce={onAllowOnce}
        onAlwaysAllow={onAlwaysAllow}
        onDeny={onDeny}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Allow this action?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Open a reply to all recipients: Alice, Bob"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Allow once"));
    expect(onAllowOnce).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Always allow"));
    expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Deny"));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("hides Always allow when no persistence callback is given", () => {
    render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.queryByText("Always allow")).not.toBeInTheDocument();
  });

  it("greys out Always allow with the deployment reason but keeps it focusable", () => {
    const onAlwaysAllow = vi.fn();
    render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onAlwaysAllow={onAlwaysAllow}
        alwaysAllowDisabledReason="Your organization requires confirmation for this action."
        onDeny={vi.fn()}
      />,
    );
    const alwaysAllow = screen.getByText("Always allow");
    // aria-disabled keeps the button in the tab order, unlike native
    // disabled, so keyboard/SR users can discover the option and the reason.
    expect(alwaysAllow).not.toBeDisabled();
    expect(alwaysAllow).toHaveAttribute("aria-disabled", "true");
    expect(alwaysAllow).toHaveAccessibleDescription(
      "Your organization requires confirmation for this action.",
    );
    alwaysAllow.focus();
    expect(alwaysAllow).toHaveFocus();
    fireEvent.click(alwaysAllow);
    expect(onAlwaysAllow).not.toHaveBeenCalled();
  });

  it("renders rich description nodes as-is", () => {
    render(
      <ActionConfirmationCard
        title="t"
        description={<ul data-testid="recipients" />}
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByTestId("recipients")).toBeInTheDocument();
  });

  it("disables all buttons while busy", () => {
    render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onAlwaysAllow={vi.fn()}
        onDeny={vi.fn()}
        isBusy
      />,
    );
    expect(screen.getByText("Allow once")).toBeDisabled();
    expect(screen.getByText("Always allow")).toBeDisabled();
    expect(screen.getByText("Deny")).toBeDisabled();
  });

  it("moves focus to the card on mount", () => {
    render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
        data-testid="card"
      />,
    );
    expect(screen.getByTestId("card")).toHaveFocus();
  });

  it("populates the polite announcement region after mount", () => {
    render(<ActionConfirmationCard onAllowOnce={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Allow this action?");
  });

  it("scrolls into view on mount only when requested", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { unmount } = render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    unmount();
    render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
        scrollIntoViewOnMount
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
