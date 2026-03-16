import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageList } from "./MessageList";

describe("MessageList", () => {
  it("uses the theme layout token for the default chat content width", () => {
    render(
      <MessageList
        messages={{}}
        messageOrder={[]}
        loadOlderMessages={vi.fn()}
        hasOlderMessages={false}
        isPending={false}
        currentSessionId={null}
        controlsContext={{}}
        onMessageAction={vi.fn(async () => true)}
        emptyStateComponent={<div>Empty state</div>}
      />,
    );

    const chatBody = screen.getByTestId("message-list");
    const contentShell = chatBody.lastElementChild;

    expect(chatBody).toHaveStyle({
      backgroundColor: "var(--theme-shell-chat-body)",
    });
    expect(chatBody.className).toContain(
      "[padding:var(--theme-spacing-shell-padding-y)_calc(var(--theme-spacing-shell-padding-x)/2)]",
    );
    expect(chatBody.className).toContain(
      "gap-[var(--theme-spacing-shell-gap)]",
    );
    expect(contentShell).toHaveStyle({
      maxWidth: "var(--theme-layout-chat-content-max-width)",
    });
    expect(screen.getByText("Empty state")).toBeTruthy();
  });

  it("preserves an explicit numeric width override when provided", () => {
    render(
      <MessageList
        messages={{}}
        messageOrder={[]}
        loadOlderMessages={vi.fn()}
        hasOlderMessages={false}
        isPending={false}
        currentSessionId={null}
        controlsContext={{}}
        onMessageAction={vi.fn(async () => true)}
        emptyStateComponent={<div>Empty state</div>}
        maxWidth={640}
      />,
    );

    const chatBody = screen.getByTestId("message-list");
    const contentShell = chatBody.lastElementChild;

    expect(chatBody).toHaveStyle({
      backgroundColor: "var(--theme-shell-chat-body)",
    });
    expect(chatBody.className).toContain(
      "[padding:var(--theme-spacing-shell-padding-y)_calc(var(--theme-spacing-shell-padding-x)/2)]",
    );
    expect(contentShell).toHaveStyle({
      maxWidth: "640px",
    });
  });
});
