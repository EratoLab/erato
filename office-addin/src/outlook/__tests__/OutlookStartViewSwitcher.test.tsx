import { componentRegistry } from "@erato/frontend/library";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OutlookStartViewSwitcher } from "../OutlookStartViewSwitcher";
import { isSessionPolicyHeld } from "../sessionPolicy";

import type { AddinStartViewProps } from "@erato/frontend/library";

function StubStartView({
  openChat,
  platform,
  acquireToken,
}: AddinStartViewProps) {
  return (
    <div data-testid="stub-start-view">
      <span data-testid="stub-platform">{platform}</span>
      <span data-testid="stub-token-availability">
        {acquireToken ? "token-capable" : "no-token"}
      </span>
      <button type="button" onClick={openChat} data-testid="stub-open-chat">
        open chat
      </button>
    </div>
  );
}

describe("OutlookStartViewSwitcher", () => {
  afterEach(() => {
    componentRegistry.AddinStartView = null;
    cleanup();
  });

  it("renders children untouched when no start view is registered", () => {
    render(
      <OutlookStartViewSwitcher platform="outlook">
        <div data-testid="chat-surface" />
      </OutlookStartViewSwitcher>,
    );

    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    expect(
      screen.queryByTestId("addin-start-view-toggle"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("addin-start-view")).not.toBeInTheDocument();
  });

  it("opens on the registered start view and toggles to chat and back", () => {
    componentRegistry.AddinStartView = StubStartView;
    render(
      <OutlookStartViewSwitcher platform="outlook">
        <div data-testid="chat-surface" />
      </OutlookStartViewSwitcher>,
    );

    expect(screen.getByTestId("stub-start-view")).toBeInTheDocument();
    expect(screen.getByTestId("stub-platform")).toHaveTextContent("outlook");
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("addin-start-view-toggle"));
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-start-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("addin-start-view-toggle"));
    expect(screen.getByTestId("stub-start-view")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
  });

  it("switches to chat via the start view's openChat prop", () => {
    componentRegistry.AddinStartView = StubStartView;
    render(
      <OutlookStartViewSwitcher platform="outlook">
        <div data-testid="chat-surface" />
      </OutlookStartViewSwitcher>,
    );

    fireEvent.click(screen.getByTestId("stub-open-chat"));
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
  });

  it("passes no acquireToken when no Graph-capable auth provider is mounted", () => {
    componentRegistry.AddinStartView = StubStartView;
    render(
      <OutlookStartViewSwitcher platform="outlook">
        <div data-testid="chat-surface" />
      </OutlookStartViewSwitcher>,
    );

    expect(screen.getByTestId("stub-token-availability")).toHaveTextContent(
      "no-token",
    );
  });

  it("holds the session policy only while the start view is shown", () => {
    componentRegistry.AddinStartView = StubStartView;
    const { unmount } = render(
      <OutlookStartViewSwitcher platform="outlook">
        <div data-testid="chat-surface" />
      </OutlookStartViewSwitcher>,
    );

    expect(isSessionPolicyHeld()).toBe(true);

    fireEvent.click(screen.getByTestId("addin-start-view-toggle"));
    expect(isSessionPolicyHeld()).toBe(false);

    fireEvent.click(screen.getByTestId("addin-start-view-toggle"));
    expect(isSessionPolicyHeld()).toBe(true);

    unmount();
    expect(isSessionPolicyHeld()).toBe(false);
  });

  it("does not touch the session policy when no start view is registered", () => {
    render(
      <OutlookStartViewSwitcher platform="outlook">
        <div data-testid="chat-surface" />
      </OutlookStartViewSwitcher>,
    );

    expect(isSessionPolicyHeld()).toBe(false);
  });
});
