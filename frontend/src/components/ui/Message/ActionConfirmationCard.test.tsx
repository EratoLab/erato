import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionConfirmationCard } from "./ActionConfirmationCard";

vi.mock("../Controls/Button", () => ({
  Button: ({
    children,
    busy,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    busy?: boolean;
    icon?: React.ReactNode;
  }) => (
    <button {...props} aria-busy={busy ? true : undefined}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </button>
  ),
}));

describe("ActionConfirmationCard", () => {
  it("shows the theme's focus style when it receives focus, not the browser's", () => {
    render(
      <ActionConfirmationCard
        description="Open a reply"
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByRole("group")).toHaveClass("focus-ring-tight");
  });

  it("renders the generic frame with the once decisions, and standing ones on request", () => {
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
    fireEvent.click(screen.getByText("Deny once"));
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Never allow")).not.toBeInTheDocument();
  });

  it("offers the standing refusal only to a consumer that can store one", () => {
    const onNeverAllow = vi.fn();
    const { rerender } = render(
      <ActionConfirmationCard onAllowOnce={vi.fn()} onDeny={vi.fn()} />,
    );
    expect(screen.queryByText("Never allow")).not.toBeInTheDocument();

    rerender(
      <ActionConfirmationCard
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
        onNeverAllow={onNeverAllow}
      />,
    );
    fireEvent.click(screen.getByText("Never allow"));
    expect(onNeverAllow).toHaveBeenCalledTimes(1);
  });

  it("pairs each once answer with its standing one, in permission order", () => {
    render(
      <ActionConfirmationCard
        onAllowOnce={vi.fn()}
        onAlwaysAllow={vi.fn()}
        onDeny={vi.fn()}
        onNeverAllow={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Allow once", "Always allow", "Deny once", "Never allow"]);
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
    expect(screen.getByText("Deny once")).toBeDisabled();
  });

  it("shows progress on the pressed Allow once button and keeps it focusable", () => {
    const onAllowOnce = vi.fn();
    const props = {
      onAllowOnce,
      onAlwaysAllow: vi.fn(),
      onDeny: vi.fn(),
    };
    const { rerender } = render(<ActionConfirmationCard {...props} />);
    fireEvent.click(screen.getByText("Allow once"));
    rerender(
      <ActionConfirmationCard
        {...props}
        isBusy
        progressLabel="Saving backup…"
      />,
    );
    const progress = screen.getByRole("button", { name: "Saving backup…" });
    expect(progress).toHaveAttribute("aria-busy", "true");
    expect(progress).toHaveAttribute("aria-disabled", "true");
    expect(progress).toBeEnabled();
    expect(screen.getByText("Always allow")).toBeDisabled();
    expect(screen.getByText("Deny once")).toBeDisabled();
    fireEvent.click(progress);
    expect(onAllowOnce).toHaveBeenCalledTimes(1);
  });

  it("shows progress on Always allow when that decision started the action", () => {
    const onAlwaysAllow = vi.fn();
    const props = { onAllowOnce: vi.fn(), onAlwaysAllow, onDeny: vi.fn() };
    const { rerender } = render(<ActionConfirmationCard {...props} />);
    fireEvent.click(screen.getByText("Always allow"));
    rerender(
      <ActionConfirmationCard {...props} isBusy progressLabel="Verifying…" />,
    );
    expect(screen.getByRole("button", { name: "Verifying…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Allow once")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Verifying…" }));
    expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
  });

  it("renders a compact resolved row instead of buttons once resolved", () => {
    render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
        status="confirmed"
        resolvedLabel="Reply opened"
        data-testid="card"
      />,
    );
    expect(screen.getByTestId("card")).toHaveTextContent("Reply opened");
    expect(screen.queryByText("Allow once")).not.toBeInTheDocument();
  });

  it("moves focus to a pending card on mount", () => {
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

  it("does not grab focus when mounted already resolved", () => {
    render(
      <ActionConfirmationCard
        title="t"
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
        status="dismissed"
        data-testid="card"
      />,
    );
    expect(screen.getByTestId("card")).not.toHaveFocus();
  });

  it("keeps focus on the card when the pending buttons resolve away", () => {
    const props = {
      title: "t",
      onAllowOnce: vi.fn(),
      onDeny: vi.fn(),
      "data-testid": "card",
    };
    const { rerender } = render(<ActionConfirmationCard {...props} />);
    screen.getByText("Deny once").focus();
    rerender(<ActionConfirmationCard {...props} status="dismissed" />);
    expect(screen.getByTestId("card")).toHaveFocus();
  });

  it("populates the polite announcement region after mount and on resolution", () => {
    const props = { onAllowOnce: vi.fn(), onDeny: vi.fn() };
    const { rerender } = render(<ActionConfirmationCard {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Allow this action?");
    rerender(
      <ActionConfirmationCard
        {...props}
        status="confirmed"
        resolvedLabel="Reply opened"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Reply opened");
  });

  it("announces the pending→resolved transition exactly once", async () => {
    const props = { onAllowOnce: vi.fn(), onDeny: vi.fn() };
    const { rerender } = render(<ActionConfirmationCard {...props} />);
    const region = screen.getByRole("status");
    // Live regions announce on DOM mutation, so count mutations directly.
    const mutations: string[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records.map(() => region.textContent ?? ""));
    });
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const resolvedProps = (
      <ActionConfirmationCard
        {...props}
        status="confirmed"
        resolvedLabel="Reply opened"
      />
    );
    rerender(resolvedProps);
    // A second render of the already-resolved card must not re-announce.
    rerender(resolvedProps);
    await Promise.resolve(); // flush the MutationObserver microtask
    observer.disconnect();
    expect(mutations).toEqual(["Reply opened"]);
  });

  it("does not announce a card that mounts already resolved", () => {
    render(
      <ActionConfirmationCard
        onAllowOnce={vi.fn()}
        onDeny={vi.fn()}
        status="confirmed"
        resolvedLabel="Reply opened"
      />,
    );
    // Reloaded transcripts mount resolved cards in bulk; an announcement
    // here would queue one polite readout per historical card.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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

  describe("with the standing answers in a row of their own", () => {
    const toolCard = (
      props: Partial<React.ComponentProps<typeof ActionConfirmationCard>> = {},
    ) => (
      <ActionConfirmationCard
        title="Run this action in Example Server?"
        onAllowOnce={vi.fn()}
        onAlwaysAllow={vi.fn()}
        onDeny={vi.fn()}
        onNeverAllow={vi.fn()}
        denyLabel="Deny"
        standingLabel="This tool:"
        data-testid="tool-card"
        {...props}
      />
    );
    const frameClasses = (element: HTMLElement) =>
      Array.from(element.classList)
        .filter((name) => !name.startsWith("mt-"))
        .sort();

    it("keeps the decision area's box exactly as the other cards have it", () => {
      const { unmount } = render(
        <ActionConfirmationCard
          title="t"
          onAllowOnce={vi.fn()}
          onDeny={vi.fn()}
          data-testid="plain-card"
        />,
      );
      const plain = frameClasses(screen.getByTestId("plain-card"));
      unmount();
      render(toolCard());
      const card = screen.getByTestId("tool-card");
      expect(frameClasses(card)).toEqual(plain);
      expect(card).toHaveAttribute("data-layout", "standing");
    });

    it("asks the question, then offers Allow once and Deny, then the tool's standing answers smaller", () => {
      const onAlwaysAllow = vi.fn();
      const onNeverAllow = vi.fn();
      render(toolCard({ onAlwaysAllow, onNeverAllow }));
      const question = screen.getByTestId("action-confirmation-question");
      expect(question).toHaveTextContent("Run this action in Example Server?");
      expect(question).toHaveClass("text-sm", "font-semibold");

      const standing = screen.getByTestId("action-confirmation-standing");
      expect(standing).toHaveClass("text-xs");
      expect(standing).toHaveTextContent(
        /^This tool:Always allow·Never allow$/,
      );
      const allowOnce = screen.getByText("Allow once");
      const deny = screen.getByText("Deny");
      expect(standing).not.toContainElement(allowOnce);
      expect(standing).not.toContainElement(deny);
      expect(allowOnce.parentElement).toBe(deny.parentElement);
      for (const label of ["Always allow", "Never allow"]) {
        expect(screen.getByText(label)).toHaveAttribute("variant", "link");
      }
      const order = [question, allowOnce, deny, standing];
      for (const [index, element] of order.slice(1).entries()) {
        expect(
          order[index].compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      // The scope word names the group, so it is said with each answer.
      const scoped = screen.getByRole("group", { name: "This tool:" });
      expect(scoped).toBe(standing);
      expect(
        within(scoped).getByRole("button", { name: "Always allow" }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByText("Always allow"));
      expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByText("Never allow"));
      expect(onNeverAllow).toHaveBeenCalledTimes(1);
    });

    it("says what is known about the tool in one quiet line that also explains the lock", () => {
      const onAlwaysAllow = vi.fn();
      const facts =
        "Your organisation has marked this tool as destructive and requires confirmation each time it runs.";
      render(
        toolCard({
          onAlwaysAllow,
          alwaysAllowDisabledReason: "Locked.",
          standingNote: facts,
        }),
      );
      const line = screen.getByTestId("action-confirmation-tool-facts");
      expect(line).toHaveTextContent(facts);
      expect(line).toHaveClass("text-xs", "text-theme-fg-muted");
      expect(screen.queryByText("Locked.")).toBeNull();
      const alwaysAllow = screen.getByText("Always allow");
      expect(alwaysAllow).toHaveAttribute("aria-disabled", "true");
      expect(alwaysAllow).toHaveAccessibleDescription(facts);
      fireEvent.click(alwaysAllow);
      expect(onAlwaysAllow).not.toHaveBeenCalled();
    });

    it.each([
      ["filled", "primary"],
      ["plain", "secondary"],
      ["loss", "secondary"],
    ] as const)(
      "styles Allow once as %s without changing what it does",
      (emphasis, variant) => {
        const onAllowOnce = vi.fn();
        render(toolCard({ onAllowOnce, allowOnceEmphasis: emphasis }));
        const allowOnce = screen.getByText("Allow once");
        expect(allowOnce).toHaveAttribute("variant", variant);
        expect(allowOnce).toHaveAttribute("data-emphasis", emphasis);
        expect(allowOnce.className).toContain(
          "data-[emphasis=loss]:border-theme-error-fg",
        );
        // Not colour alone: a loss also gets an icon and says why.
        const statesLoss = emphasis === "loss";
        expect(allowOnce.querySelector("svg") !== null).toBe(statesLoss);
        if (statesLoss) {
          expect(allowOnce).toHaveAccessibleDescription(
            "This card names something this action may remove or empty.",
          );
        } else {
          expect(allowOnce).not.toHaveAttribute("aria-describedby");
        }
        expect(allowOnce).toHaveAccessibleName("Allow once");
        fireEvent.click(allowOnce);
        expect(onAllowOnce).toHaveBeenCalledTimes(1);
      },
    );

    it("leaves every other card's layout as it was", () => {
      render(
        <ActionConfirmationCard
          title="t"
          onAllowOnce={vi.fn()}
          onAlwaysAllow={vi.fn()}
          onDeny={vi.fn()}
          onNeverAllow={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("action-confirmation-standing")).toBeNull();
      expect(screen.getByText("Allow once")).toHaveAttribute(
        "variant",
        "primary",
      );
      expect(screen.getByText("Deny once").parentElement).toBe(
        screen.getByText("Always allow").parentElement,
      );
    });
  });
});
