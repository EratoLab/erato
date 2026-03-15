import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatMessage } from "./ChatMessage";

import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/chat/store/messagingStore", () => ({
  useMessagingStore: () => ({
    streaming: {
      toolCalls: {},
      isStreaming: false,
      currentMessageId: null,
    },
  }),
}));

vi.mock("@/hooks/ui/useImageLightbox", () => ({
  useImageLightbox: () => ({
    isOpen: false,
    selectedImage: null,
    openLightbox: vi.fn(),
    closeLightbox: vi.fn(),
  }),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useMessageFeedbackFeature: () => ({
    enabled: false,
    commentsEnabled: false,
  }),
}));

vi.mock("../Message/MessageContent", () => ({
  MessageContent: () => <div data-testid="message-content-stub" />,
}));

vi.mock("../Message/ImageLightbox", () => ({
  ImageLightbox: () => null,
}));

describe("ChatMessage", () => {
  it("exposes stable message hooks for theme.css selectors", async () => {
    const message: UiChatMessage = {
      id: "msg_1",
      content: [{ content_type: "text", text: "Hello from the assistant" }],
      role: "assistant",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
      status: "complete",
    };

    const Controls = () => <div data-testid="message-controls-probe" />;

    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");

    render(
      <I18nProvider i18n={i18n}>
        <ChatMessage
          message={message}
          controls={Controls}
          controlsContext={{
            currentUserId: "user_1",
            dialogOwnerId: "user_1",
            isSharedDialog: false,
          }}
          onMessageAction={async () => true}
        />
      </I18nProvider>,
    );

    const messageShell = screen.getByTestId("message-assistant");
    expect(messageShell).toHaveAttribute("data-ui", "chat-message");
    expect(messageShell).toHaveAttribute("data-role", "assistant");
    expect(screen.getByTestId("message-controls-probe")).toBeInTheDocument();
  });
});
