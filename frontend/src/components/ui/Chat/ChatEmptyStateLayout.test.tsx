import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    document.documentElement.setAttribute("data-system-glass", "");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-system-glass");
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

  it("publishes nothing while the composer is centred or outside the app", () => {
    const centred = renderLayout("centered").container
      .firstElementChild as HTMLElement;
    expect(centred.style.getPropertyValue("--chat-composer-height")).toBe("");

    document.documentElement.removeAttribute("data-system-glass");
    const browser = renderLayout("conversation").container
      .firstElementChild as HTMLElement;
    expect(browser.style.getPropertyValue("--chat-composer-height")).toBe("");
  });
});
