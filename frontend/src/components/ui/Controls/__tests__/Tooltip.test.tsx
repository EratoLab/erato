import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Tooltip } from "../Tooltip";

const renderTooltip = () => {
  render(
    <Tooltip content="Helpful hint" delay={0}>
      <button type="button">Trigger</button>
    </Tooltip>,
  );

  return screen.getByRole("button", { name: "Trigger" });
};

describe("Tooltip", () => {
  it("should show the tooltip when the trigger receives focus", async () => {
    const trigger = renderTooltip();

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      trigger.focus();
    });

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Helpful hint");
  });

  it("should hide the tooltip when the trigger loses focus", async () => {
    const trigger = renderTooltip();

    act(() => {
      trigger.focus();
    });
    await screen.findByRole("tooltip");

    act(() => {
      trigger.blur();
    });

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("should still show the tooltip on hover", async () => {
    const trigger = renderTooltip();

    fireEvent.mouseEnter(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Helpful hint",
    );

    fireEvent.mouseLeave(trigger);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("should point the trigger at the tooltip with aria-describedby only while visible", async () => {
    const trigger = renderTooltip();

    expect(trigger).not.toHaveAttribute("aria-describedby");

    act(() => {
      trigger.focus();
    });

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveAttribute("id");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);

    act(() => {
      trigger.blur();
    });

    await waitFor(() => {
      expect(trigger).not.toHaveAttribute("aria-describedby");
    });
  });

  // WCAG 1.4.13: hover-shown content must be dismissable without moving the
  // pointer or focus, which is why this is a document listener rather than a
  // key handler on the trigger.
  it("should dismiss a hover-shown tooltip when Escape is pressed", async () => {
    const trigger = renderTooltip();

    fireEvent.mouseEnter(trigger);
    await screen.findByRole("tooltip");
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("should only swallow Escape while the tooltip is visible", async () => {
    const onEscape = vi.fn();
    // Mirrors ModalBase: a bubble-phase document listener that closes the
    // surrounding dialog.
    document.addEventListener("keydown", onEscape);

    try {
      const trigger = renderTooltip();

      // Hidden: Escape must reach the dialog as usual.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(1);

      // Visible: Escape dismisses the tooltip and stops there.
      fireEvent.mouseEnter(trigger);
      await screen.findByRole("tooltip");

      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      });

      // Hidden again: the listener is gone, so Escape is untouched.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener("keydown", onEscape);
    }
  });
});
