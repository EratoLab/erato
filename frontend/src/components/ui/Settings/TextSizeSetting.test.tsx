import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { TextSizeSetting } from "./TextSizeSetting";

describe("TextSizeSetting", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("offers the four sizes and applies the chosen one", () => {
    render(
      <ThemeProvider
        enableCustomTheme={false}
        persistThemeMode={false}
        persistTextSize={false}
      >
        <TextSizeSetting />
      </ThemeProvider>,
    );

    const control = screen.getByRole("tablist", { name: "Text size" });
    expect(
      within(control)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Small", "Default", "Large", "Extra large"]);
    expect(
      within(control).getByRole("tab", { name: "Default" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(control).getByRole("tab", { name: "Large" }));

    expect(within(control).getByRole("tab", { name: "Large" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.documentElement).toHaveAttribute("data-text-size", "large");
  });
});
