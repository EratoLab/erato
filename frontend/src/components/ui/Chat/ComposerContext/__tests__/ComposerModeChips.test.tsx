import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerModeChips } from "../ComposerModeChips";

import type { ComposerMode } from "../types";

afterEach(cleanup);

const scheduling = (over: Partial<ComposerMode> = {}): ComposerMode => ({
  id: "outlook.scheduling",
  label: "Scheduling",
  icon: "clock",
  description:
    "Scheduling stays on for an hour after Erato last read your calendar (until 3:40 PM).",
  endLabel: "End scheduling",
  onEnd: vi.fn(),
  endedAnnouncement: "Scheduling ended. Your draft is sent again.",
  ...over,
});

const live = () =>
  document.querySelector<HTMLElement>('[data-ui="composer-mode-live"]')!;

describe("ComposerModeChips", () => {
  it("draws the label, a hidden glyph and an end button described by the reason", () => {
    render(<ComposerModeChips modes={[scheduling()]} />);

    const chip = screen.getByRole("group", { name: "Scheduling" });
    expect(chip).toHaveAttribute("data-ui", "composer-mode-chip");
    expect(chip).toHaveAttribute("data-mode-id", "outlook.scheduling");
    expect(chip).toHaveAttribute("title", scheduling().description);
    expect(
      chip.querySelector('[data-ui="composer-mode-chip-label"]'),
    ).toHaveTextContent("Scheduling");
    expect(chip.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBe(
      null,
    );
    const end = screen.getByRole("button", { name: "End scheduling" });
    expect(end).toHaveAttribute("data-ui", "composer-mode-end");
    expect(end).toHaveAccessibleDescription(scheduling().description!);
    expect(end).toBeEnabled();
  });

  it("ends the mode, says so once and hands focus to the composer", () => {
    const mode = scheduling();
    const onFocusComposer = vi.fn();
    const { rerender } = render(
      <ComposerModeChips modes={[mode]} onFocusComposer={onFocusComposer} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "End scheduling" }));
    rerender(
      <ComposerModeChips modes={[]} onFocusComposer={onFocusComposer} />,
    );

    expect(mode.onEnd).toHaveBeenCalledTimes(1);
    expect(onFocusComposer).toHaveBeenCalledTimes(1);
    expect(live()).toHaveTextContent(
      "Scheduling ended. Your draft is sent again.",
    );
    expect(live()).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("keeps a locked end button disabled with the reason as its title", () => {
    render(
      <ComposerModeChips
        modes={[
          scheduling({
            locked: true,
            lockReason: "Can't change this while the message is being sent",
          }),
        ]}
      />,
    );

    const end = screen.getByRole("button", { name: "End scheduling" });
    expect(end).toBeDisabled();
    expect(end).toHaveAttribute(
      "title",
      "Can't change this while the message is being sent",
    );
    expect(screen.getByRole("group", { name: "Scheduling" })).toHaveAttribute(
      "data-locked",
      "true",
    );
  });

  it("keeps the live region in place with no mode and draws no chip", () => {
    render(<ComposerModeChips modes={[]} />);

    expect(live()).toBeInTheDocument();
    expect(live()).toHaveClass("sr-only");
    expect(document.querySelector('[data-ui="composer-mode-chip"]')).toBeNull();
  });
});
