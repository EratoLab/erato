import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { McpToolDecisionControl } from "./McpToolDecisionControl";

import type { McpToolDecisionControlProps } from "./McpToolDecisionControl";

const renderControl = (
  overrides: Partial<McpToolDecisionControlProps> = {},
) => {
  const onChange = vi.fn();
  render(
    <McpToolDecisionControl
      value="ask"
      policy="ask"
      availability={{ allowAlways: true, askAvailable: true }}
      onChange={onChange}
      aria-label="Get issue"
      {...overrides}
    />,
  );
  return { onChange };
};

const radios = () =>
  within(screen.getByRole("radiogroup")).getAllByRole("radio");

const radio = (decision: string) => {
  const found = radios().find(
    (candidate) => candidate.dataset.decision === decision,
  );
  if (!found) {
    throw new Error(`No ${decision} radio`);
  }
  return found;
};

describe("McpToolDecisionControl", () => {
  it("is a labelled radio group of three named radios with the effective state checked", () => {
    renderControl();

    const group = screen.getByRole("radiogroup", { name: "Get issue" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(radio("allow")).toHaveAccessibleName("Allow");
    expect(radio("ask")).toHaveAccessibleName("Ask each time (policy default)");
    expect(radio("never")).toHaveAccessibleName("Never allow");
    expect(radio("ask")).toHaveAttribute("aria-checked", "true");
    expect(radio("allow")).toHaveAttribute("aria-checked", "false");
    expect(radio("never")).toHaveAttribute("aria-checked", "false");
    // The policy default is the one marked; the marker is visual, the name
    // carries the words.
    expect(radio("ask")).toHaveAttribute("data-policy-default", "true");
    expect(radio("allow")).not.toHaveAttribute("data-policy-default");
  });

  it("keeps one tab stop, on the checked radio", () => {
    renderControl({ value: "never" });

    expect(radio("never")).toHaveAttribute("tabindex", "0");
    expect(radio("allow")).toHaveAttribute("tabindex", "-1");
    expect(radio("ask")).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click and never re-reports the checked state", () => {
    const { onChange } = renderControl();

    fireEvent.click(radio("never"));
    expect(onChange).toHaveBeenCalledWith("never");
    fireEvent.click(radio("ask"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("walks the options with the arrow keys, wrapping, and Home/End without selecting", () => {
    const { onChange } = renderControl();

    radio("ask").focus();
    fireEvent.keyDown(radio("ask"), { key: "ArrowRight" });
    expect(radio("never")).toHaveFocus();
    // The tab stop follows the walk; the checked state does not.
    expect(radio("never")).toHaveAttribute("tabindex", "0");
    expect(radio("ask")).toHaveAttribute("tabindex", "-1");
    expect(radio("ask")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(radio("never"), { key: "ArrowRight" });
    expect(radio("allow")).toHaveFocus();
    fireEvent.keyDown(radio("allow"), { key: "ArrowLeft" });
    expect(radio("never")).toHaveFocus();
    fireEvent.keyDown(radio("never"), { key: "Home" });
    expect(radio("allow")).toHaveFocus();
    fireEvent.keyDown(radio("allow"), { key: "End" });
    expect(radio("never")).toHaveFocus();
    fireEvent.keyDown(radio("never"), { key: "ArrowUp" });
    expect(radio("ask")).toHaveFocus();
    fireEvent.keyDown(radio("ask"), { key: "ArrowDown" });
    expect(radio("never")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    // Space and Enter are the buttons' own activation, which jsdom does not
    // run from a key event; the click is what they produce.
    fireEvent.click(radio("never"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("never");
  });

  it("puts the tab stop back on the checked radio once focus leaves the group", () => {
    renderControl();
    render(<button type="button">Elsewhere</button>);
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    radio("ask").focus();
    fireEvent.keyDown(radio("ask"), { key: "ArrowLeft" });
    expect(radio("allow")).toHaveAttribute("tabindex", "0");

    fireEvent.blur(radio("allow"), { relatedTarget: elsewhere });
    expect(radio("ask")).toHaveAttribute("tabindex", "0");
    expect(radio("allow")).toHaveAttribute("tabindex", "-1");
  });

  it("marks a state the deployment does not store as disabled, focusable and never selected", async () => {
    const { onChange } = renderControl({
      policy: "ask",
      availability: { allowAlways: false, askAvailable: true },
    });

    expect(radio("allow")).toHaveAttribute("aria-disabled", "true");
    expect(radio("allow")).not.toHaveAttribute("disabled");
    expect(radio("ask")).not.toHaveAttribute("aria-disabled");
    expect(radio("never")).not.toHaveAttribute("aria-disabled");

    fireEvent.click(radio("allow"));
    expect(onChange).not.toHaveBeenCalled();

    // The arrow still lands there so the reason can be read, but the
    // selection does not follow.
    fireEvent.keyDown(radio("ask"), { key: "ArrowLeft" });
    expect(radio("allow")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.focus(radio("allow"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Always allow is switched off by the approval policy.",
    );
  });

  it("disables asking where the deployment has no approvals", () => {
    renderControl({
      value: "allow",
      policy: "auto",
      availability: { allowAlways: true, askAvailable: false },
    });

    expect(radio("ask")).toHaveAttribute("aria-disabled", "true");
    expect(radio("allow")).toHaveAccessibleName("Allow (policy default)");
    expect(radio("allow")).toHaveAttribute("aria-checked", "true");
  });

  it("locks every option while a decision is in flight", () => {
    const { onChange } = renderControl({ disabled: true });

    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
    for (const option of radios()) {
      expect(option).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.click(radio("never"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
