import { componentRegistry } from "@erato/frontend/library";
import * as matchers from "@testing-library/jest-dom/matchers";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutlookStartViewSwitcher } from "../OutlookStartViewSwitcher";
import { isSessionPolicyHeld } from "../sessionPolicy";

import type {
  AddinChatAccess,
  AddinChatAccessProviderProps,
  AddinStartViewProps,
} from "@erato/frontend/library";

expect.extend(matchers);

function StubStartView({
  openChat,
  platform,
  acquireToken,
  chatAccess,
}: AddinStartViewProps) {
  return (
    <div data-testid="stub-start-view">
      <span data-testid="stub-platform">{platform}</span>
      <span data-testid="stub-chat-access">{chatAccess?.status}</span>
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
    componentRegistry.AddinChatAccessProvider = null;
    delete window.ERATO_ADDIN_CHAT_ACCESS_POLICY_REQUIRED;
    cleanup();
    vi.restoreAllMocks();
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

  // The control paints from the stylesheet alone: an inline style here would
  // be unreachable for a customer theme.
  it("paints the toggle from the floating skin class, never inline", () => {
    componentRegistry.AddinStartView = StubStartView;
    render(
      <OutlookStartViewSwitcher platform="outlook">
        <div data-testid="chat-surface" />
      </OutlookStartViewSwitcher>,
    );

    const toggle = screen.getByTestId("addin-start-view-toggle");
    expect(toggle).not.toHaveAttribute("style");
    expect(toggle).toHaveClass("floating-control-skin");
    expect(toggle).toHaveClass("border");
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

  const pane = () => (
    <OutlookStartViewSwitcher platform="outlook">
      <div data-testid="chat-surface" />
    </OutlookStartViewSwitcher>
  );

  it.each(["loading", "denied", "error"] as const)(
    "keeps the start view usable and blocks both chat entry points when %s",
    (status) => {
      componentRegistry.AddinStartView = StubStartView;
      componentRegistry.AddinChatAccessProvider = ({ children }) =>
        children({ status });
      render(pane());
      expect(screen.getByTestId("stub-chat-access")).toHaveTextContent(status);
      expect(
        screen.queryByTestId("addin-start-view-toggle"),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("stub-open-chat"));
      expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
      expect(isSessionPolicyHeld()).toBe(true);
    },
  );

  it("observes grants and revocation while the policy stays mounted in both views", () => {
    let access: AddinChatAccess = { status: "loading" };
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Policy({ children, platform }: AddinChatAccessProviderProps) {
      expect(platform).toBe("outlook");
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return children(access);
    }
    componentRegistry.AddinStartView = StubStartView;
    componentRegistry.AddinChatAccessProvider = Policy;
    const { rerender } = render(pane());
    access = { status: "allowed" };
    rerender(pane());
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    expect(isSessionPolicyHeld()).toBe(false);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();

    access = { status: "denied" };
    rerender(pane());
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    expect(screen.getByTestId("stub-start-view")).toBeInTheDocument();
    expect(isSessionPolicyHeld()).toBe(true);
    access = { status: "allowed" };
    rerender(pane());
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("blocks a retained openChat callback after a grant is revoked", () => {
    let access: AddinChatAccess = { status: "allowed" };
    let retainedOpenChat = () => {};
    componentRegistry.AddinChatAccessProvider = ({ children }) =>
      children(access);
    componentRegistry.AddinStartView = function CapturingStartView(props) {
      if (props.chatAccess?.status === "allowed")
        retainedOpenChat = props.openChat;
      return <StubStartView {...props} />;
    };
    const { rerender } = render(pane());
    access = { status: "denied" };
    rerender(pane());
    act(() => retainedOpenChat());
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    access = { status: "allowed" };
    rerender(pane());
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
  });

  it.each(["loading", "denied", "error"] as const)(
    "does not fall through to chat without a start view when %s",
    (status) => {
      componentRegistry.AddinChatAccessProvider = ({ children }) =>
        children({ status });
      render(pane());
      expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(isSessionPolicyHeld()).toBe(true);
    },
  );

  it.each([true, "true", "invalid"])(
    "requires a policy when configured as %s",
    (required) => {
      window.ERATO_ADDIN_CHAT_ACCESS_POLICY_REQUIRED = required;
      render(pane());
      expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Chat access could not be verified",
      );
    },
  );

  it.each([undefined, false, "false"])(
    "allows chat without a policy when configured as %s",
    (required) => {
      window.ERATO_ADDIN_CHAT_ACCESS_POLICY_REQUIRED = required;
      render(pane());
      expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    },
  );

  it("accepts a registered policy when required", () => {
    window.ERATO_ADDIN_CHAT_ACCESS_POLICY_REQUIRED = "true";
    componentRegistry.AddinChatAccessProvider = ({ children }) =>
      children({ status: "allowed" });
    render(pane());
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
  });

  it("keeps the start view usable when the policy throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    componentRegistry.AddinStartView = StubStartView;
    componentRegistry.AddinChatAccessProvider = () => {
      throw new Error("lookup failed");
    };
    render(pane());
    expect(screen.getByTestId("stub-chat-access")).toHaveTextContent("error");
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
  });

  it("keeps chat unavailable while a policy suspends", () => {
    const pending = new Promise(() => {});
    componentRegistry.AddinStartView = StubStartView;
    componentRegistry.AddinChatAccessProvider = () => {
      throw pending;
    };
    render(pane());
    expect(screen.getByTestId("stub-chat-access")).toHaveTextContent("loading");
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
  });

  it.each([undefined, null, { status: "allow" }])(
    "refuses a malformed runtime policy decision: %s",
    (access) => {
      componentRegistry.AddinStartView = StubStartView;
      componentRegistry.AddinChatAccessProvider = ({ children }) =>
        children(access as AddinChatAccess);
      render(pane());
      expect(screen.getByTestId("stub-chat-access")).toHaveTextContent("error");
      fireEvent.click(screen.getByTestId("stub-open-chat"));
      expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    },
  );
});
