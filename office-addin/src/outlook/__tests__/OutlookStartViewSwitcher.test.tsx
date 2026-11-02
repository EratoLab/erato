import {
  applyComponentKitRegistrations,
  componentRegistry,
} from "@erato/frontend/library";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Component, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutlookStartViewSwitcher } from "../OutlookStartViewSwitcher";
import { isSessionPolicyHeld } from "../sessionPolicy";

import type {
  AddinChatAccess,
  AddinChatAccessProviderProps,
  AddinStartViewProps,
} from "@erato/frontend/library";
import type { ReactNode } from "react";

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
    delete window.ERATO_COMPONENT_KIT_VERSION_STANCE;
    delete window.ERATO_COMPONENT_KITS;
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

  it("treats allowed → loading → allowed as a new decision, requiring explicit re-entry", () => {
    let access: AddinChatAccess = { status: "allowed" };
    componentRegistry.AddinStartView = StubStartView;
    componentRegistry.AddinChatAccessProvider = ({ children }) =>
      children(access);
    const { rerender } = render(pane());
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    access = { status: "loading" };
    rerender(pane());
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    expect(screen.getByTestId("stub-chat-access")).toHaveTextContent("loading");
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    access = { status: "allowed" };
    rerender(pane());
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
  });

  it.each(["start", "chat"] as const)(
    "lets a throwing %s child reach its own error boundary",
    (view) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      class PaneBoundary extends Component<
        { children: ReactNode },
        { error: Error | null }
      > {
        state = { error: null as Error | null };
        static getDerivedStateFromError(error: Error) {
          return { error };
        }
        render() {
          return this.state.error ? (
            <p role="alert">{this.state.error.message}</p>
          ) : (
            this.props.children
          );
        }
      }
      function ThrowingView(): never {
        throw new Error("pane render failed");
      }
      componentRegistry.AddinChatAccessProvider = ({ children }) =>
        children({ status: "allowed" });
      if (view === "start") componentRegistry.AddinStartView = ThrowingView;
      render(
        <PaneBoundary>
          <OutlookStartViewSwitcher platform="outlook">
            <ThrowingView />
          </OutlookStartViewSwitcher>
        </PaneBoundary>,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("pane render failed");
      expect(
        screen.queryByText(/Chat access could not be verified/),
      ).not.toBeInTheDocument();
    },
  );

  it.each([true, false])(
    "requires a rejected policy only when policy-required is %s",
    (required) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      window.ERATO_ADDIN_CHAT_ACCESS_POLICY_REQUIRED = required;
      window.ERATO_COMPONENT_KIT_VERSION_STANCE = "enforce";
      window.ERATO_COMPONENT_KITS = [
        {
          name: "old-policy",
          builtAgainstSharedSurfaceMinor: 23,
          components: [
            {
              extensionPoint: "AddinChatAccessProvider",
              component: ({ children }) => children({ status: "denied" }),
              priority: 50,
            },
          ],
        },
      ];
      applyComponentKitRegistrations();
      expect(componentRegistry.AddinChatAccessProvider).toBeNull();
      render(pane());
      if (required) {
        expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
          "Chat access could not be verified",
        );
      } else {
        expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
      }
    },
  );

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

  it.each([true, false])(
    "retries a throwing policy in place (start view: %s)",
    (hasStartView) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      let failed = true;
      if (hasStartView) componentRegistry.AddinStartView = StubStartView;
      componentRegistry.AddinChatAccessProvider = ({ children }) => {
        if (failed) throw new Error("temporary policy error");
        return children({ status: "allowed" });
      };
      render(pane());
      // A second failed attempt must not temporarily grant access.
      fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
      expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
      failed = false;
      fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
      expect(
        screen.queryByRole("button", { name: "Try Again" }),
      ).not.toBeInTheDocument();
      if (hasStartView) {
        expect(screen.getByTestId("stub-chat-access")).toHaveTextContent(
          "allowed",
        );
        expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId("stub-open-chat"));
      }
      expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    },
  );

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

  it("clears a prior grant when the policy stops reporting a decision", () => {
    let reporting = true;
    componentRegistry.AddinStartView = StubStartView;
    componentRegistry.AddinChatAccessProvider = function ConditionalPolicy({
      children,
    }) {
      return reporting ? children({ status: "allowed" }) : null;
    };
    const { rerender } = render(pane());
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    reporting = false;
    rerender(pane());
    expect(screen.getByTestId("stub-chat-access")).toHaveTextContent("loading");
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
  });

  it("invalidates access while a previously resolved policy suspends", async () => {
    let suspended = false;
    let resume = () => {};
    const pending = new Promise<void>((resolve) => {
      resume = resolve;
    });
    componentRegistry.AddinStartView = StubStartView;
    componentRegistry.AddinChatAccessProvider = ({ children }) => {
      if (suspended) throw pending;
      return children({ status: "allowed" });
    };
    const { rerender } = render(pane());
    fireEvent.click(screen.getByTestId("stub-open-chat"));
    suspended = true;
    rerender(pane());
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    expect(screen.getByTestId("stub-chat-access")).toHaveTextContent("loading");
    suspended = false;
    await act(async () => {
      resume();
      await pending;
    });
    expect(screen.getByTestId("stub-chat-access")).toHaveTextContent("allowed");
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
