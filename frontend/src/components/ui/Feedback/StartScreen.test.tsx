import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartScreen } from "./StartScreen";

import "@testing-library/jest-dom";

describe("StartScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only the page colour during a fast start, a spinner after a second", () => {
    vi.spyOn(window.performance, "now").mockReturnValue(400);
    render(<StartScreen />);

    expect(screen.getByTestId("start-screen")).toBeEmptyDOMElement();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(
      screen.getByTestId("start-screen").querySelector(
        '[data-ui="spinner"]',
      ),
    ).not.toBeNull();
  });

  it("shows the spinner at once later in the page's life", () => {
    vi.spyOn(window.performance, "now").mockReturnValue(5000);
    render(<StartScreen />);

    expect(
      screen.getByTestId("start-screen").querySelector(
        '[data-ui="spinner"]',
      ),
    ).not.toBeNull();
  });
});
