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

    expect(contentShell).toHaveStyle({
      maxWidth: "640px",
    });
  });
});
