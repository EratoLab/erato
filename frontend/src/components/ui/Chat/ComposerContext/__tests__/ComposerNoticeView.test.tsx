import {
  cleanup,
  fireEvent,
  render as renderBare,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { ComposerNoticeView } from "../ComposerNoticeView";
import { ComposerContextGlyph } from "../composerContextIcons";

import type { ReactElement, ReactNode } from "react";

afterEach(cleanup);

const Themed = ({ children }: { children: ReactNode }) => (
  <ThemeProvider
    enableCustomTheme={false}
    initialThemeMode="light"
    persistThemeMode={false}
  >
    {children}
  </ThemeProvider>
);

const render = (ui: ReactElement) => renderBare(ui, { wrapper: Themed });

const notice = () =>
  document.querySelector<HTMLElement>('[data-ui="composer-notice"]')!;

const pathsOf = (root: Element | null) =>
  [...(root?.querySelectorAll("path") ?? [])]
    .map((path) => path.getAttribute("d"))
    .join("|");

describe("ComposerNoticeView", () => {
  const polite = () =>
    notice().querySelector<HTMLElement>('[data-ui="composer-notice-polite"]')!;
  const assertive = () =>
    notice().querySelector<HTMLElement>(
      '[data-ui="composer-notice-assertive"]',
    )!;

  it("speaks politely for info and warnings, assertively for errors", () => {
    const { rerender } = render(
      <ComposerNoticeView
        notice={{ id: "n", tone: "warning", text: "Choose a comment first." }}
      />,
    );
    expect(polite()).toHaveAttribute("role", "status");
    expect(assertive()).toHaveAttribute("role", "alert");
    expect(notice()).toHaveAttribute("data-tone", "warning");
    expect(polite()).toHaveTextContent("Choose a comment first.");
    expect(assertive()).toBeEmptyDOMElement();

    const politeNode = polite();
    const assertiveNode = assertive();
    rerender(
      <ComposerNoticeView
        notice={{
          id: "n",
          tone: "error",
          text: "Couldn't read the selection.",
        }}
      />,
    );
    expect(polite()).toBe(politeNode);
    expect(assertive()).toBe(assertiveNode);
    expect(polite()).toHaveAttribute("role", "status");
    expect(assertive()).toHaveAttribute("role", "alert");
    expect(polite()).toBeEmptyDOMElement();
    expect(assertive()).toHaveTextContent("Couldn't read the selection.");
    // The live regions are the only ones: the alert inside is inert.
    expect(
      notice().querySelectorAll('[role="alert"], [role="status"]'),
    ).toHaveLength(2);
  });

  it("keeps both live regions while the host opts in, empty or not", () => {
    const { rerender } = render(<ComposerNoticeView notice={null} />);
    const node = notice();
    const politeNode = polite();
    expect(politeNode).toBeEmptyDOMElement();
    expect(assertive()).toBeEmptyDOMElement();
    // Empty, it takes no room in the shell's gapped column.
    expect(node).toHaveClass("absolute");

    rerender(
      <ComposerNoticeView
        notice={{ id: "n", tone: "info", text: "Reading the document…" }}
      />,
    );
    expect(notice()).toBe(node);
    expect(node).not.toHaveClass("absolute");
    expect(polite()).toBe(politeNode);
    rerender(
      <ComposerNoticeView
        notice={{ id: "n", tone: "info", text: "Still reading…" }}
      />,
    );
    expect(polite()).toBe(politeNode);
    expect(politeNode).toHaveTextContent("Still reading…");
  });

  it("draws a spinner while busy, and the host's actions and dismiss", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ComposerNoticeView
        notice={{
          id: "n",
          tone: "info",
          text: "Reading the document…",
          busy: true,
          actions: [{ id: "skip", label: "Send without it", onSelect }],
          onDismiss,
        }}
      />,
    );
    const spinner = notice().querySelector(
      '[data-ui="composer-notice-icon"] [data-ui="spinner"]',
    );
    expect(spinner).not.toBeNull();
    expect(spinner).not.toHaveAttribute("role");
    fireEvent.click(screen.getByRole("button", { name: "Send without it" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("draws a progress count it does not announce, in the same node as it ticks", () => {
    const { rerender } = render(
      <ComposerNoticeView
        notice={{
          id: "progress",
          tone: "info",
          text: "Reading comments…",
          busy: true,
          progressLabel: "3 of 12",
        }}
      />,
    );
    const progress = notice().querySelector<HTMLElement>(
      '[data-ui="composer-notice-progress"]',
    )!;
    expect(progress).toHaveTextContent("3 of 12");
    expect(progress).toHaveAttribute("aria-hidden", "true");
    // A count split over two lines ("3 of" / "12") reads as two numbers.
    expect(progress).toHaveClass("whitespace-nowrap");
    // Wrapped to its own line, a margin would indent it.
    expect(progress.className).not.toMatch(/\bm[lx]-/);
    expect(polite()).toContainElement(progress);
    const spoken = polite().cloneNode(true) as HTMLElement;
    spoken
      .querySelectorAll('[aria-hidden="true"]')
      .forEach((node) => node.remove());
    expect(spoken.textContent?.trim()).toBe("Reading comments…");
    const text = screen.getByText("Reading comments…", { exact: false });

    rerender(
      <ComposerNoticeView
        notice={{
          id: "progress",
          tone: "info",
          text: "Reading comments…",
          busy: true,
          progressLabel: "4 of 12",
        }}
      />,
    );
    expect(notice().querySelector('[data-ui="composer-notice-progress"]')).toBe(
      progress,
    );
    expect(progress).toHaveTextContent("4 of 12");
    expect(screen.getByText("Reading comments…", { exact: false })).toBe(text);
  });

  it("hands focus on when a pressed action takes the notice away", () => {
    const onFocusLost = vi.fn();
    function Host() {
      const [shown, setShown] = useState(true);
      return (
        <ComposerNoticeView
          onFocusLost={onFocusLost}
          notice={
            shown
              ? {
                  id: "slow",
                  tone: "info",
                  text: "Word is still handing over the document.",
                  actions: [
                    {
                      id: "skip",
                      label: "Send without document",
                      onSelect: () => setShown(false),
                    },
                  ],
                }
              : null
          }
        />
      );
    }
    render(<Host />);
    const button = screen.getByRole("button", {
      name: "Send without document",
    });
    button.focus();
    fireEvent.click(button);
    expect(screen.queryByRole("button")).toBeNull();
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone when it was elsewhere", () => {
    const onFocusLost = vi.fn();
    const shown = {
      id: "n",
      tone: "info" as const,
      text: "Word is still handing over the document.",
    };
    const { rerender } = render(
      <>
        <button type="button">elsewhere</button>
        <ComposerNoticeView notice={shown} onFocusLost={onFocusLost} />
      </>,
    );
    screen.getByRole("button", { name: "elsewhere" }).focus();
    rerender(
      <>
        <button type="button">elsewhere</button>
        <ComposerNoticeView notice={null} onFocusLost={onFocusLost} />
      </>,
    );
    expect(onFocusLost).not.toHaveBeenCalled();
  });

  it.each([
    ["error", "error"],
    ["warning", "attention"],
  ] as const)(
    "marks a %s notice as a chip in that tone, never with the dismiss (x)",
    (tone, state) => {
      render(
        <>
          <ComposerNoticeView
            notice={{ id: "n", tone, text: "Something", onDismiss: vi.fn() }}
          />
          <span data-testid="chip-glyph">
            <ComposerContextGlyph icon="document" state={state} tone={tone} />
          </span>
        </>,
      );
      const mark = pathsOf(
        notice().querySelector('[data-ui="composer-notice-icon"]'),
      );
      expect(mark).not.toBe("");
      expect(mark).toBe(pathsOf(screen.getByTestId("chip-glyph")));
      expect(mark).not.toBe(
        pathsOf(screen.getByRole("button", { name: "Dismiss" })),
      );
    },
  );
});
