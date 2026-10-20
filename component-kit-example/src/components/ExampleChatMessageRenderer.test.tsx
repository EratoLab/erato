import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ExampleChatMessageRenderer } from "./ExampleChatMessageRenderer";

import type {
  ChatMessageHostComponents,
  ChatMessageProps,
  UiChatMessage,
} from "@erato/frontend/library";

const renderer = vi.hoisted(() => ({
  sentWith: undefined as unknown,
}));

// The host's hook needs the host's providers; the kit only reads its chips.
vi.mock("@erato/frontend/shared", () => ({
  MessageContent: () => <div data-testid="content" />,
  useChatMessageRenderer: () =>
    renderer.sentWith === undefined ? {} : { sentWith: renderer.sentWith },
}));

afterEach(() => {
  cleanup();
  renderer.sentWith = undefined;
});

const chips = [
  {
    id: "word.document",
    kind: "word.document",
    icon: "document",
    label: "Supply agreement.docx",
  },
];

const message = (role: "user" | "assistant"): UiChatMessage =>
  ({
    id: `m-${role}`,
    role,
    sender: role,
    content: [{ content_type: "text", text: "Summarize" }],
    createdAt: "2026-10-20T10:00:00Z",
  }) as UiChatMessage;

const MessageSentWith = ({ chips: drawn }: { chips: readonly unknown[] }) => (
  <ul data-testid="sent-with">{drawn.length}</ul>
);

const renderMessage = (
  role: "user" | "assistant",
  hostComponents?: Partial<ChatMessageHostComponents>,
) =>
  render(
    <ExampleChatMessageRenderer
      {...({
        message: message(role),
        controlsContext: {},
        onMessageAction: async () => true,
        hostComponents,
      } as unknown as ChatMessageProps)}
    />,
  );

it("draws the host's sent-with row on a user message", () => {
  renderer.sentWith = chips;
  renderMessage("user", {
    MessageSentWith:
      MessageSentWith as ChatMessageHostComponents["MessageSentWith"],
  });
  expect(screen.getByTestId("sent-with").textContent).toBe("1");
});

it("draws nothing on an assistant message", () => {
  renderer.sentWith = chips;
  renderMessage("assistant", {
    MessageSentWith:
      MessageSentWith as ChatMessageHostComponents["MessageSentWith"],
  });
  expect(screen.queryByTestId("sent-with")).toBeNull();
});

it("draws nothing for a host before 1.21, which hands over neither", () => {
  renderMessage("user", {});
  expect(screen.queryByTestId("sent-with")).toBeNull();

  renderer.sentWith = chips;
  renderMessage("user", {});
  expect(screen.queryByTestId("sent-with")).toBeNull();
});
