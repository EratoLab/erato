import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ThemeProvider,
  THEME_MODE_LOCAL_STORAGE_KEY,
} from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";

import { MermaidBlock } from "./MermaidBlock";

import type { Messages } from "@lingui/core";
import type React from "react";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaidMock }));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => {
  mermaidMock.initialize.mockClear();
  mermaidMock.render.mockReset();
  mermaidMock.render.mockResolvedValue({
    svg: '<svg data-testid="mermaid-svg"><text>Rendered diagram</text></svg>',
  });
  window.localStorage.removeItem(THEME_MODE_LOCAL_STORAGE_KEY);
});

const renderBlock = (
  props: Partial<React.ComponentProps<typeof MermaidBlock>> = {},
) =>
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider>
        <MermaidBlock
          content="flowchart TD\n  A --> B"
          isStreaming={false}
          {...props}
        />
      </ThemeProvider>
    </I18nProvider>,
  );

describe("MermaidBlock", () => {
  it("renders a valid diagram after lazy-loading Mermaid", async () => {
    const { container } = renderBlock();

    await waitFor(() => {
      expect(
        container.querySelector("svg[data-testid='mermaid-svg']"),
      ).toBeInTheDocument();
    });

    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        theme: "default",
      }),
    );
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.stringMatching(/^mermaid-/),
      expect.stringContaining("flowchart TD"),
    );
    expect(
      screen.getByRole("button", { name: "Show code" }),
    ).toBeInTheDocument();
  });

  it("toggles between diagram and syntax-highlighted code", async () => {
    renderBlock();

    const showCodeButton = await screen.findByRole("button", {
      name: "Show code",
    });
    fireEvent.click(showCodeButton);

    expect(screen.getByText("flowchart")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show diagram" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Show diagram" }));
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Mermaid diagram" }),
      ).toBeInTheDocument();
    });
  });

  it("shows code and does not load Mermaid while streaming", () => {
    renderBlock({ isStreaming: true });

    expect(screen.getByText("flowchart")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Mermaid diagram" })).toBeNull();
    expect(mermaidMock.render).not.toHaveBeenCalled();
  });

  it("falls back to code when Mermaid rejects invalid syntax", async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error("Invalid diagram"));
    renderBlock();

    await waitFor(() => {
      expect(
        screen.getByText(
          "This diagram could not be rendered. Showing code instead.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("flowchart")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Mermaid diagram" })).toBeNull();
  });
});
