import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markSystemGlass } from "@/lib/shellSystemGlass";
import { installHostShell, removeHostShell } from "@/test/hostShellStub";

import { ChatEmptyStateLayout } from "./ChatEmptyStateLayout";

import type { ChatEmptyStateLayoutMode } from "./ChatEmptyStateLayout";

describe("ChatEmptyStateLayout composer height", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          this.callback([], this);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(72);
    installHostShell({ systemGlass: 1 });
    markSystemGlass(document.documentElement);
  });

  afterEach(() => {
    removeHostShell();
    markSystemGlass(document.documentElement);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderLayout = (mode: ChatEmptyStateLayoutMode) =>
    render(
      <ChatEmptyStateLayout
        mode={mode}
        above={<div />}
        composer={<div />}
        below={null}
      />,
    );

  it("publishes the composer's height on a conversation in the app", () => {
    const { container, unmount } = renderLayout("conversation");
    const shell = container.firstElementChild as HTMLElement;

    expect(shell.style.getPropertyValue("--chat-composer-height")).toBe("72px");
    unmount();
    expect(shell.style.getPropertyValue("--chat-composer-height")).toBe("");
  });

  it("starts and stops publishing when the app's answer changes", () => {
    removeHostShell();
    const listeners: Array<(payload: unknown) => void> = [];
    installHostShell({ share: 1 });
    window.ERATO_SHELL = {
      ...(window.ERATO_SHELL as object),
      on: (_event: string, listener: (payload: unknown) => void) => {
        listeners.push(listener);
        return () => {};
      },
    };
    act(() => markSystemGlass(document.documentElement));
    const shell = renderLayout("conversation").container
      .firstElementChild as HTMLElement;
    expect(shell.style.getPropertyValue("--chat-composer-height")).toBe("");

    act(() => listeners.forEach((listener) => listener({ available: true })));
    expect(shell.style.getPropertyValue("--chat-composer-height")).toBe("72px");

    act(() => listeners.forEach((listener) => listener({ available: false })));
    expect(shell.style.getPropertyValue("--chat-composer-height")).toBe("");
  });

  it("publishes nothing while the composer is centred or outside the app", () => {
    const centred = renderLayout("centered").container
      .firstElementChild as HTMLElement;
    expect(centred.style.getPropertyValue("--chat-composer-height")).toBe("");

    removeHostShell();
    act(() => markSystemGlass(document.documentElement));
    const browser = renderLayout("conversation").container
      .firstElementChild as HTMLElement;
    expect(browser.style.getPropertyValue("--chat-composer-height")).toBe("");
  });
});
