import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { WordEditReport } from "../WordEditReport";

const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(() => {
  cleanup();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

it.each([
  undefined,
  { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
])("explains clipboard failure and allows retry", async (value) => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
  render(
    <WordEditReport
      compact
      outcomes={[
        { index: 0, paragraph: 1, status: "applied", excerpt: "New text" },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
  expect(
    await screen.findByText("The report could not be copied. Try again."),
  ).toBeInTheDocument();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
  expect(await screen.findByText("Copied!")).toBeInTheDocument();
  expect(
    screen.queryByText("The report could not be copied. Try again."),
  ).toBeNull();
  expect(writeText).toHaveBeenCalledWith("Paragraph 1: Applied — New text");
});
