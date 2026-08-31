import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatMessage } from "./ChatMessage";

import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { Messages } from "@lingui/core";

const messageContentMock = vi.hoisted(() => vi.fn());
const showVerboseAssistantErrorsMock = vi.hoisted(() => vi.fn());
const showCopyErrorReportMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/chat/store/messagingStore", () => ({
  useMessagingStore: () => ({
    streaming: {
      content: [],
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

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "status-error",
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useErrorReportFeature: () => ({
    showVerboseAssistantErrors: showVerboseAssistantErrorsMock(),
    showCopyErrorReport: showCopyErrorReportMock(),
  }),
  useMessageFeedbackFeature: () => ({
    enabled: false,
    commentsEnabled: false,
  }),
}));

vi.mock("../Message/MessageContent", () => ({
  MessageContent: (props: unknown) => {
    messageContentMock(props);
    return <div data-testid="message-content-stub" />;
  },
}));

vi.mock("../Message/ImageLightbox", () => ({
  ImageLightbox: () => null,
}));

// Stubbed so placement can be asserted without a query client. `null` is the
// real component's behaviour while the file ids are still resolving.
const attachmentsRenderMock = vi.hoisted(() => vi.fn());
vi.mock("./MessageAttachments", () => ({
  MessageAttachments: () => attachmentsRenderMock(),
}));

describe("ChatMessage", () => {
  beforeEach(() => {
    messageContentMock.mockClear();
    attachmentsRenderMock.mockReturnValue(
      <div data-testid="attachments-stub" />,
    );
    showVerboseAssistantErrorsMock.mockReturnValue(false);
    showCopyErrorReportMock.mockReturnValue(true);
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

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
    expect(messageShell).toHaveClass("chat-message-skin");
    expect(messageShell.className).toContain(
      "bg-[var(--theme-message-assistant)]",
    );
    expect(messageShell.className).toContain(
      "hover:bg-[var(--theme-message-hover)]",
    );
    // Located by hook, not by position: a user message carrying files puts the
    // attachments wrapper first, so `firstElementChild` is not the body there.
    expect(messageShell.querySelector('[data-ui="message-body"]')).toHaveStyle({
      gap: "var(--theme-spacing-message-gap)",
    });
    expect(messageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ preserveSoftLineBreaks: false }),
    );
    expect(screen.getByTestId("message-controls-probe")).toBeInTheDocument();
  });

  it("preserves soft line breaks for user message rendering", async () => {
    const message: UiChatMessage = {
      id: "msg_user_1",
      content: [{ content_type: "text", text: "First\nSecond" }],
      role: "user",
      sender: "user",
      authorId: "user_1",
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

    expect(messageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ preserveSoftLineBreaks: true }),
    );
  });

  it.each([
    ["user", ["message-attachments", "message-body"]],
    ["assistant", ["message-body"]],
  ] as const)(
    "places %s attachments relative to the message body",
    async (role, expectedHooks) => {
      const message: UiChatMessage = {
        id: `msg_files_${role}`,
        content: [{ content_type: "text", text: "See attached" }],
        role,
        sender: role,
        authorId: `${role}_1`,
        createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
        status: "complete",
        input_files_ids: ["file_1"],
      };

      const { i18n } = await import("@lingui/core");
      i18n.load("en", enMessages as unknown as Messages);
      i18n.activate("en");

      render(
        <I18nProvider i18n={i18n}>
          <ChatMessage
            message={message}
            controls={() => null}
            controlsContext={{
              currentUserId: "user_1",
              dialogOwnerId: "user_1",
              isSharedDialog: false,
            }}
            onMessageAction={async () => true}
          />
        </I18nProvider>,
      );

      const messageShell = screen.getByTestId(`message-${role}`);
      expect(
        Array.from(messageShell.children).map((child) =>
          child.getAttribute("data-ui"),
        ),
      ).toEqual(expectedHooks);

      // A user message tints the body alone, so the attachments have to sit
      // outside it; an assistant message keeps them inline.
      const body = messageShell.querySelector('[data-ui="message-body"]');
      expect(body?.contains(screen.getByTestId("attachments-stub"))).toBe(
        role === "assistant",
      );
    },
  );

  it("keeps the attachments hook out of the layout until files resolve", async () => {
    attachmentsRenderMock.mockReturnValue(null);

    const message: UiChatMessage = {
      id: "msg_files_pending",
      content: [{ content_type: "text", text: "See attached" }],
      role: "user",
      sender: "user",
      authorId: "user_1",
      createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
      status: "complete",
      input_files_ids: ["file_1"],
    };

    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");

    render(
      <I18nProvider i18n={i18n}>
        <ChatMessage
          message={message}
          controls={() => null}
          controlsContext={{
            currentUserId: "user_1",
            dialogOwnerId: "user_1",
            isSharedDialog: false,
          }}
          onMessageAction={async () => true}
        />
      </I18nProvider>,
    );

    // The wrapper is keyed off the file ids, which are known before the files
    // are, so it renders empty for a beat. `empty:hidden` keeps a theme from
    // painting a bare box in that window.
    const wrapper = screen
      .getByTestId("message-user")
      .querySelector('[data-ui="message-attachments"]');
    expect(wrapper).toBeEmptyDOMElement();
    expect(wrapper).toHaveClass("empty:hidden");
  });

  it("hides verbose assistant error details by default", async () => {
    const message: UiChatMessage = {
      id: "msg_error_hidden",
      content: [],
      role: "assistant",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
      status: "error",
      error: {
        error_type: "provider_error",
        error_description: "Provider returned diagnostic details",
      },
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

    expect(
      screen.getByText("The assistant was unable to respond."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Provider returned diagnostic details"),
    ).not.toBeInTheDocument();
  });

  it("shows verbose assistant error details when enabled", async () => {
    showVerboseAssistantErrorsMock.mockReturnValue(true);

    const message: UiChatMessage = {
      id: "msg_error_visible",
      content: [],
      role: "assistant",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
      status: "error",
      error: {
        error_type: "provider_error",
        error_description: "Provider returned diagnostic details",
      },
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

    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(
      screen.getByText("Provider returned diagnostic details"),
    ).toBeInTheDocument();
  });

  it("shows the offending text and edit guidance for prompt injection guardrails", async () => {
    const message: UiChatMessage = {
      id: "msg_prompt_injection_error",
      content: [],
      role: "assistant",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
      status: "error",
      error: {
        error_type: "content_filter",
        error_description:
          "The request was filtered because it matched a configured prompt injection guardrail.",
        filter_details: {
          pattern_id: "ignore_previous_instructions",
          matched_text: "Ignore all previous instructions",
        },
      },
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

    expect(
      screen.getByText(
        "The request was blocked because it matched a prompt injection guardrail.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Offending text")).toBeInTheDocument();
    expect(
      screen.getByText("Ignore all previous instructions"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Please edit the previous message to remove the offending text before continuing.",
      ),
    ).toBeInTheDocument();
  });

  it("copies the backend-rendered assistant error report when enabled", async () => {
    const message: UiChatMessage = {
      id: "msg_error_copy",
      content: [],
      role: "assistant",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
      status: "error",
      error: {
        error_type: "provider_error",
        error_description: "Provider returned diagnostic details",
      },
      error_report: "## Error Report\n\nprovider failed",
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

    fireEvent.click(screen.getByRole("button", { name: "Copy error report" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "## Error Report\n\nprovider failed",
      );
      expect(
        screen.getByRole("button", { name: "Copy error report" }),
      ).toHaveTextContent("Copied");
    });
  });

  describe("MCP needing-auth notice", () => {
    const LocationProbe = () => {
      const location = useLocation();
      return <div data-testid="location-search">{location.search}</div>;
    };

    const renderAssistantMessage = async (
      overrides: Partial<UiChatMessage>,
      {
        isSharedDialog = false,
        withRouter = true,
      }: { isSharedDialog?: boolean; withRouter?: boolean } = {},
    ) => {
      const message: UiChatMessage = {
        id: "msg_mcp_auth",
        content: [{ content_type: "text", text: "Answered without tools" }],
        role: "assistant",
        sender: "assistant",
        authorId: "assistant_1",
        createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
        status: "complete",
        ...overrides,
      };

      const Controls = () => <div data-testid="message-controls-probe" />;

      const { i18n } = await import("@lingui/core");
      i18n.load("en", enMessages as unknown as Messages);
      i18n.activate("en");

      const tree = (
        <I18nProvider i18n={i18n}>
          <ChatMessage
            message={message}
            controls={Controls}
            controlsContext={{
              currentUserId: "user_1",
              dialogOwnerId: "user_1",
              isSharedDialog,
            }}
            onMessageAction={async () => true}
          />
          {withRouter && <LocationProbe />}
        </I18nProvider>
      );

      render(withRouter ? <MemoryRouter>{tree}</MemoryRouter> : tree);
    };

    it("renders the notice with the server name and a working settings link", async () => {
      await renderAssistantMessage({
        mcp_servers_needing_auth: ["github-server"],
      });

      expect(screen.getByTestId("mcp-needs-auth-notice")).toHaveTextContent(
        "github-server is available in this chat but not connected, so its tools were not used.",
      );

      fireEvent.click(screen.getByTestId("mcp-needs-auth-connect"));

      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "?preferencesDialog=open&preferencesTab=serversTools",
      );
    });

    it("enumerates multiple servers in a single notice", async () => {
      await renderAssistantMessage({
        mcp_servers_needing_auth: ["github-server", "jira-server"],
      });

      const notices = screen.getAllByTestId("mcp-needs-auth-notice");
      expect(notices).toHaveLength(1);
      expect(notices[0]).toHaveTextContent(
        "github-server, jira-server are available in this chat but not connected, so their tools were not used.",
      );
    });

    it("renders nothing without the metadata", async () => {
      await renderAssistantMessage({});

      expect(
        screen.queryByTestId("mcp-needs-auth-notice"),
      ).not.toBeInTheDocument();
    });

    it("does not treat genuinely unavailable servers as needing auth", async () => {
      await renderAssistantMessage({
        mcp_servers_unavailable: ["broken-server"],
      });

      expect(
        screen.queryByTestId("mcp-needs-auth-notice"),
      ).not.toBeInTheDocument();
    });

    it("keeps the notice but suppresses Connect on the shared-dialog surface", async () => {
      await renderAssistantMessage(
        { mcp_servers_needing_auth: ["github-server"] },
        { isSharedDialog: true },
      );

      expect(screen.getByTestId("mcp-needs-auth-notice")).toHaveTextContent(
        "github-server is available in this chat but not connected, so its tools were not used.",
      );
      // Share-link viewers have no settings dialog to land in.
      expect(
        screen.queryByTestId("mcp-needs-auth-connect"),
      ).not.toBeInTheDocument();
    });

    it("keeps the notice but suppresses Connect where no Router is mounted", async () => {
      await renderAssistantMessage(
        { mcp_servers_needing_auth: ["github-server"] },
        { withRouter: false },
      );

      expect(screen.getByTestId("mcp-needs-auth-notice")).toHaveTextContent(
        "github-server is available in this chat but not connected, so its tools were not used.",
      );
      // Kit/add-in hosts mount no settings-dialog chrome to answer the click.
      expect(
        screen.queryByTestId("mcp-needs-auth-connect"),
      ).not.toBeInTheDocument();
    });
  });

  describe("assistant mentions", () => {
    const renderMessage = async (message: UiChatMessage) => {
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
    };

    it("hands a user message's resolved mentions to the content renderer", async () => {
      await renderMessage({
        id: "msg_user_mentions",
        content: [{ content_type: "text", text: "ask @Researcher" }],
        role: "user",
        sender: "user",
        authorId: "user_1",
        createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
        status: "complete",
        mentioned_assistants: [{ id: "assistant-1", name: "Researcher" }],
      });

      expect(messageContentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mentionedAssistants: [{ id: "assistant-1", name: "Researcher" }],
        }),
      );
    });

    it("withholds mentions from assistant messages", async () => {
      await renderMessage({
        id: "msg_assistant_mentions",
        content: [{ content_type: "text", text: "quoting @Researcher" }],
        role: "assistant",
        sender: "assistant",
        authorId: "assistant_1",
        createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
        status: "complete",
        mentioned_assistants: [{ id: "assistant-1", name: "Researcher" }],
      });

      expect(messageContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ mentionedAssistants: undefined }),
      );
    });
  });
});
