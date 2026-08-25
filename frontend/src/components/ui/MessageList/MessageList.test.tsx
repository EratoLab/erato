import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageList } from "./MessageList";

import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

describe("MessageList", () => {
  it("centers empty state components independently from message width", () => {
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
    const emptyStateShell = chatBody.lastElementChild;

    expect(chatBody).toHaveClass("chat-body-skin");
    expect(chatBody.className).toContain(
      "[padding:var(--theme-spacing-shell-padding-y)_calc(var(--theme-spacing-shell-padding-x)/2)]",
    );
    expect(chatBody.className).toContain(
      "gap-[var(--theme-spacing-shell-gap)]",
    );
    expect(emptyStateShell?.className).toContain("w-full");
    expect(emptyStateShell?.className).toContain("justify-center");
    expect(screen.getByText("Empty state")).toBeTruthy();
  });

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
      />,
    );

    const chatBody = screen.getByTestId("message-list");
    const contentShell = chatBody.lastElementChild;

    expect(chatBody).toHaveClass("chat-body-skin");
    expect(chatBody.className).toContain(
      "[padding:var(--theme-spacing-shell-padding-y)_calc(var(--theme-spacing-shell-padding-x)/2)]",
    );
    expect(contentShell).toHaveStyle({
      maxWidth: "var(--theme-layout-chat-content-max-width)",
    });
  });

  it("renders a model-switch marker only on the turn it belongs to", () => {
    const messages = {
      user1: {
        id: "user1",
        role: "user" as const,
        content: [{ content_type: "text" as const, text: "first" }],
        createdAt: "2026-01-01T00:00:00.000Z",
        sender: "user",
        authorId: "author-1",
      },
      user2: {
        id: "user2",
        role: "user" as const,
        content: [{ content_type: "text" as const, text: "second" }],
        createdAt: "2026-01-01T00:01:00.000Z",
        sender: "user",
        authorId: "author-1",
      },
    };

    render(
      <I18nProvider i18n={i18n}>
        <MessageList
          messages={messages}
          messageOrder={["user1", "user2"]}
          loadOlderMessages={vi.fn()}
          hasOlderMessages={false}
          isPending={false}
          currentSessionId="chat-1"
          controlsContext={{}}
          onMessageAction={vi.fn(async () => true)}
          messageRenderer={({ message }) => <div>{message.id}</div>}
          modelSwitches={{
            user2: { fromModel: "Model One", toModel: "Model Two" },
          }}
        />
      </I18nProvider>,
    );

    const markers = screen.getAllByTestId("model-switch-marker");

    expect(markers).toHaveLength(1);
    // The marker introduces the turn that changed model, so it must precede it.
    expect(markers[0].nextElementSibling?.textContent).toBe("user2");
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
